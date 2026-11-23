import { stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type { Item, Reader, SessionMeta } from "./types"
import { Tail, capPatch, firstLine, lastMatch, parse, parseUnified, unquote } from "./util"

export const ROOT = join(homedir(), ".codex")
const SESSIONS = join(ROOT, "sessions")
const STRING = '((?:[^"\\\\]|\\\\.)*)'

const AUTO_REVIEW = /"thread_source":"guardian_review"|"model":"codex-auto-review"/
const peeked = new Map<string, { key: string; cwd?: string; prompt?: string; review: boolean }>()

async function names(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const text = await Bun.file(join(ROOT, "session_index.jsonl")).text().catch(() => "")
  for (const line of text.split("\n")) {
    const rec = line ? parse(line) : undefined
    if (rec?.id && rec.thread_name) out.set(rec.id, rec.thread_name)
  }
  return out
}

function texts(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : ""
  return content.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).filter(Boolean).join("\n")
}

export async function list(): Promise<SessionMeta[]> {
  const titles = await names()
  const out: SessionMeta[] = []
  const glob = new Bun.Glob("**/rollout-*.jsonl")
  for await (const rel of glob.scan({ cwd: SESSIONS })) {
    const path = join(SESSIONS, rel)
    const s = await stat(path).catch(() => undefined)
    if (!s?.size) continue
    const id = basename(path, ".jsonl").slice(-36)
    const key = `${s.mtimeMs}:${s.size}`
    let hit = peeked.get(path)
    if (hit?.key !== key) {
      const head = await Bun.file(path).slice(0, Math.min(s.size, 262144)).text()
      hit = { key, cwd: unquote(lastMatch(head.slice(0, 16384), new RegExp(`"cwd":"${STRING}"`, "g"))), review: AUTO_REVIEW.test(head) }
      if (!titles.has(id)) {
        const line = head.split("\n").find((l) => l.includes('"type":"UserMessage"'))
        const text = line ? texts(parse(line)?.payload?.item?.content) : ""
        if (text) hit.prompt = firstLine(text, 80)
      }
      peeked.set(path, hit)
    }
    if (hit.review) continue
    out.push({ source: "codex", id, title: titles.get(id) ?? hit.prompt ?? id.slice(0, 8), path, updatedAt: s.mtimeMs, cwd: hit.cwd })
  }
  return out
}

function command(argv: unknown): string {
  if (!Array.isArray(argv)) return String(argv ?? "")
  return argv.length >= 3 && /^-l?c$/.test(argv[1]) ? String(argv[2]) : argv.join(" ")
}

function duration(d: any): number | undefined {
  return d && typeof d.secs === "number" ? d.secs * 1000 + Math.round((d.nanos ?? 0) / 1e6) : undefined
}

function convert(payload: any): Item | undefined {
  const item = payload.item
  const t: number | undefined = payload.started_at_ms
  const span = payload.completed_at_ms && t ? payload.completed_at_ms - t : undefined
  const id: string = item.id
  const failed = item.status === "failed" || item.status === "declined"
  switch (item.type) {
    case "UserMessage": {
      const text = texts(item.content)
      return text ? { id, t, k: "user", text } : undefined
    }
    case "AgentMessage": {
      const text = texts(item.content)
      return text.trim() ? { id, t, k: "text", text } : undefined
    }
    case "Reasoning": {
      const text = [...(item.summary_text ?? []), ...(item.raw_content ?? [])].join("\n\n")
      return text.trim() ? { id, t, k: "think", text, ms: span } : undefined
    }
    case "CommandExecution":
      return {
        id, t, k: "tool", name: "shell",
        input: { command: command(item.command), cwd: String(item.cwd ?? "").replace(/^file:\/\//, "") },
        status: failed || (item.exit_code ?? 0) !== 0 ? "err" : "ok",
        out: item.aggregated_output ?? "",
        ms: duration(item.duration) ?? span,
      }
    case "McpToolCall": {
      const structured = item.result?.structuredContent
      const out = structured ? (typeof structured.content === "string" ? structured.content : JSON.stringify(structured, null, 2)) : texts(item.result?.content)
      return { id, t, k: "tool", name: `${item.server}/${item.tool}`, input: item.arguments, status: failed ? "err" : "ok", out: item.error?.message ?? out, ms: span }
    }
    case "FileChange": {
      const files = Object.entries<any>(item.changes ?? {}).map(([file, change]) => ({
        file,
        hunks: change.unified_diff
          ? parseUnified(change.unified_diff)
          : [{ o: 0, n: 1, lines: String(change.content ?? "").split("\n").map((l) => (change.type === "delete" ? "-" : "+") + l) }],
      }))
      return { id, t, k: "tool", name: "patch", input: { files: files.map((f) => f.file) }, status: failed ? "err" : "ok", patch: capPatch(files), ms: span }
    }
    case "Extension": {
      const results: any[] = item.results ?? []
      const out = results.map((r) => [r.title, r.url, r.snippet].filter(Boolean).join("\n")).join("\n\n")
      const { type: _type, id: _id, kind: _kind, results: _results, action, ...rest } = item
      return { id, t, k: "tool", name: item.kind ?? "extension", input: action?.queries ? { queries: action.queries } : rest, status: "ok", out, ms: span }
    }
    case "ImageView":
      return { id, t, k: "tool", name: "view_image", input: { path: String(item.path ?? "").replace(/^file:\/\//, "") }, status: "ok", ms: span }
    case "SubAgentActivity":
      return { id: `${id}:${payload.started_at_ms ?? ""}`, t, k: "note", kind: "system", text: `subagent ${item.kind ?? "activity"} ${item.agent_thread_id ?? ""}`.trim() }
    case "ContextCompaction":
      return { id, t, k: "note", kind: "compact", text: "context compacted" }
    default:
      return { id: id ?? `${item.type}:${t}`, t, k: "note", kind: "system", text: String(item.type), detail: JSON.stringify(item, null, 2) }
  }
}

export function open(path: string, id: string): Reader {
  const tail = new Tail(path)
  const items = new Map<string, Item>()
  const meta: SessionMeta = { source: "codex", id, title: id.slice(0, 8), path, updatedAt: 0 }
  let titled = false

  return {
    meta,
    items,
    watch: [path],
    async poll() {
      const touched = new Map<string, Item>()
      const before = JSON.stringify(meta)
      const { lines, reset } = await tail.read()
      if (reset) items.clear()
      for (const line of lines) {
        if (!line.includes('"item_completed"') && !line.includes('"session_meta"') && !line.includes('"thread_settings_applied"') && !line.includes('"turn_aborted"')) continue
        const rec = parse(line)
        const p = rec?.payload
        if (!p) continue
        if (rec.type === "session_meta") {
          meta.cwd = p.cwd ?? meta.cwd
          meta.branch = p.git?.branch ?? meta.branch
        } else if (p.type === "thread_settings_applied") meta.model = p.thread_settings?.model ?? meta.model
        else if (p.type === "turn_aborted") {
          const item: Item = { id: `abort:${rec.ordinal ?? rec.timestamp}`, t: Date.parse(rec.timestamp) || undefined, k: "note", kind: "abort", text: "interrupted" }
          items.set(item.id, item)
          touched.set(item.id, item)
        } else if (p.type === "item_completed" && p.item) {
          const item = convert(p)
          if (!item) continue
          items.set(item.id, item)
          touched.set(item.id, item)
        }
      }
      if (!titled || lines.length) {
        titled = true
        const title = (await names()).get(id)
        const first = [...items.values()].find((i) => i.k === "user")
        meta.title = title ?? (first?.k === "user" ? firstLine(first.text, 80) : meta.title)
      }
      const s = await stat(path).catch(() => undefined)
      if (s) meta.updatedAt = s.mtimeMs
      return { items: [...touched.values()], meta: JSON.stringify(meta) !== before, reset }
    },
  }
}
