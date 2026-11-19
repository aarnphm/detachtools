import { Database } from "bun:sqlite"
import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { type Message, decode, millis, msg, msgs, num, str } from "./pb"
import type { Item, Reader, SessionMeta, ToolItem } from "./types"
import { firstLine, parse } from "./util"

export const ROOT = join(homedir(), ".gemini", "antigravity-cli")
const CONVERSATIONS = join(ROOT, "conversations")

const USER_INPUT = 14
const PLANNER = 15
const SYSTEM_MESSAGE = 101
const TOOL = 132
const DONE = 3
const FAILED = new Set([4, 5, 6, 7])
const TASK_MARK = "\nTask:\n"
const titles = new Map<string, string>()

function task(text: string): { preface?: string; body: string } {
  const at = text.lastIndexOf(TASK_MARK)
  if (at < 0 || !text.startsWith("Browser tools are provided")) return { body: text }
  return { preface: text.slice(0, at).trim(), body: text.slice(at + TASK_MARK.length).trim() }
}

function when(stamp: string | undefined): number {
  return stamp ? Date.parse(stamp.replace(" ", "T").replace(/(\.\d{3})\d+/, "$1")) || 0 : 0
}

async function mtime(path: string): Promise<number> {
  const [db, wal] = await Promise.all([stat(path).catch(() => undefined), stat(`${path}-wal`).catch(() => undefined)])
  return Math.max(db?.mtimeMs ?? 0, wal?.mtimeMs ?? 0)
}

function query<T>(path: string, sql: string, ...args: (string | number)[]): T[] {
  let db: Database | undefined
  try {
    db = new Database(path, { readonly: true })
    return db.query(sql).all(...args) as T[]
  } catch {
    return []
  } finally {
    db?.close()
  }
}

interface Summary {
  conversation_id: string
  title: string
  preview: string
  last_modified_time: string
  workspace_uris: string
  parent_conversation_id: string
}

export async function list(): Promise<SessionMeta[]> {
  const rows = query<Summary>(
    join(ROOT, "conversation_summaries.db"),
    "select conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id from conversation_summaries",
  )
  const out: SessionMeta[] = []
  for (const row of rows) {
    const path = join(CONVERSATIONS, `${row.conversation_id}.db`)
    const touched = await mtime(path)
    if (!touched) continue
    const uris: string[] = parse(row.workspace_uris) ?? []
    out.push({
      source: "argon",
      id: row.conversation_id,
      title: row.title || titles.get(row.conversation_id) || row.conversation_id.slice(0, 8),
      path,
      updatedAt: when(row.last_modified_time) || touched,
      cwd: uris[0]?.replace(/^file:\/\//, ""),
      parent: row.parent_conversation_id || undefined,
    })
  }
  for (const meta of out) {
    if (meta.title !== meta.id.slice(0, 8) || titles.has(meta.id)) continue
    const first = query<{ step_payload: Uint8Array }>(meta.path, "select step_payload from steps where step_type = ? order by idx limit 1", USER_INPUT)[0]
    const text = first ? str(msg(decode(first.step_payload), 19), 2) : undefined
    titles.set(meta.id, text ? firstLine(task(text).body, 80) : "")
    meta.title = titles.get(meta.id) || meta.title
  }
  return out
}

interface Step {
  idx: number
  step_type: number
  status: number
  step_payload: Uint8Array
  failed: number
}

function call(m: Message | undefined): { id: string; name: string; input: unknown } | undefined {
  const id = str(m, 1)
  const name = str(m, 2)
  if (!id || !name) return undefined
  const raw = str(m, 3) ?? ""
  return { id, name, input: parse(raw) ?? raw }
}

function longest(m: Message | undefined, depth = 0): string {
  let best = ""
  if (!m || depth > 5) return best
  for (const values of m.values()) {
    for (const v of values) {
      if (!(v instanceof Uint8Array) || v.length < 4) continue
      const nested = decode(v)
      const candidate = nested ? longest(nested, depth + 1) : new TextDecoder().decode(v)
      if (candidate.length > best.length && !candidate.includes("�")) best = candidate
    }
  }
  return best
}

export function open(path: string, id: string): Reader {
  const items = new Map<string, Item>()
  const meta: SessionMeta = { source: "argon", id, title: id.slice(0, 8), path, updatedAt: 0 }
  const seen = new Map<number, string>()
  let last = -1
  let stamp = 0

  function convert(step: Step, put: (item: Item) => void) {
    const root = decode(step.step_payload)
    if (!root) return
    const info = msg(root, 5)
    const t = millis(info, 1)
    const key = `s${step.idx}`
    if (step.step_type === USER_INPUT) {
      const text = str(msg(root, 19), 2) ?? ""
      const { preface, body } = task(text)
      if (body) put({ id: key, t, k: "user", text: body })
      if (preface) put({ id: `${key}:pre`, t, k: "note", kind: "meta", text: "launcher preface", detail: preface })
      if (meta.title === id.slice(0, 8) && body) meta.title = firstLine(body, 80)
    } else if (step.step_type === PLANNER) {
      const plan = msg(root, 20)
      const thinking = str(plan, 3)
      const text = str(plan, 1) ?? str(plan, 8)
      if (thinking?.trim()) put({ id: `${key}:think`, t, k: "think", text: thinking, ms: millis(plan, 11) })
      if (text?.trim()) put({ id: key, t, k: "text", text })
      for (const c of msgs(plan, 7).map(call)) {
        if (c && !items.has(c.id)) put({ id: c.id, t, k: "tool", name: c.name, input: c.input, status: "run" })
      }
    } else if (step.step_type === TOOL) {
      const c = call(msg(info, 4))
      const done = millis(info, 8)
      const failed = step.failed === 1 || FAILED.has(step.status)
      const next: ToolItem = {
        id: c?.id ?? key,
        t,
        k: "tool",
        name: c?.name ?? "tool",
        input: c?.input ?? {},
        status: failed ? "err" : step.status === DONE ? "ok" : "run",
        out: str(msg(msg(root, 140), 2), 1) ?? (failed ? longest(msg(root, 140)) : undefined),
        ms: done && t ? Math.max(0, done - t) : undefined,
      }
      const prior = items.get(next.id)
      put(prior?.k === "tool" ? { ...next, t: prior.t ?? next.t } : next)
    } else if (step.step_type === SYSTEM_MESSAGE) {
      const body = msg(root, 114)
      const text = str(msg(msg(body, 2), 10), 1) ?? str(body, 1) ?? "system message"
      put({ id: key, t, k: "note", kind: "system", text: firstLine(text), detail: text })
    } else {
      const text = longest(new Map([...root].filter(([field]) => field !== 5)))
      put({ id: key, t, k: "note", kind: "system", text: `step type ${step.step_type}${text ? `: ${firstLine(text, 72)}` : ""}`, detail: text || undefined })
    }
  }

  return {
    meta,
    items,
    watch: [CONVERSATIONS],
    async poll() {
      const now = await mtime(path)
      if (now === stamp) return { items: [], meta: false }
      stamp = now
      const before = JSON.stringify(meta)
      const touched = new Map<string, Item>()
      const put = (item: Item) => {
        items.set(item.id, item)
        touched.set(item.id, item)
      }
      const steps = query<Step>(
        path,
        "select idx, step_type, status, step_payload, (error_details is not null and length(error_details) > 0) as failed from steps where idx >= ? order by idx",
        Math.max(0, last - 16),
      )
      for (const step of steps) {
        const sig = `${step.status}:${step.step_payload?.length ?? 0}:${step.failed}`
        if (seen.get(step.idx) === sig || !step.step_payload) continue
        seen.set(step.idx, sig)
        last = Math.max(last, step.idx)
        convert(step, put)
      }
      const summary = query<Summary>(
        join(ROOT, "conversation_summaries.db"),
        "select conversation_id, title, preview, last_modified_time, workspace_uris, parent_conversation_id from conversation_summaries where conversation_id = ?",
        id,
      )[0]
      if (summary?.title) meta.title = summary.title
      const uris: string[] = summary ? (parse(summary.workspace_uris) ?? []) : []
      meta.cwd = uris[0]?.replace(/^file:\/\//, "") ?? meta.cwd
      meta.parent = summary?.parent_conversation_id || undefined
      meta.updatedAt = when(summary?.last_modified_time) || now
      return { items: [...touched.values()], meta: JSON.stringify(meta) !== before }
    },
  }
}
