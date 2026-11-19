import { readdir, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, join } from "node:path"
import type { Item, NoteKind, Reader, SessionMeta, ToolItem } from "./types"
import { Tail, capPatch, firstLine, lastMatch, parse, unquote } from "./util"

export const ROOT = join(homedir(), ".claude", "projects")

const AGENT_TOOLS = new Set(["Agent", "Task"])
const RELEVANT = /"type":\s*"(?:assistant|user|system|ai-title)"/
const STRING = '((?:[^"\\\\]|\\\\.)*)'

interface Prompt {
  kind: "user" | "note" | "skip"
  note?: NoteKind
  text: string
  detail?: string
}

function inner(body: string, tag: string): string | undefined {
  return new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(body)?.[1]?.trim()
}

function classify(rec: any, raw: string): Prompt {
  const body = raw.replace(/<system-reminder>[\s\S]*?<\/system-reminder>\s*/g, "").trim()
  if (!body) return { kind: "skip", text: "" }
  const command = inner(body, "command-name")
  if (command) {
    const args = inner(body, "command-args")
    return { kind: "user", text: args ? `${command} ${args}` : command }
  }
  const bash = inner(body, "bash-input")
  if (bash) return { kind: "user", text: `! ${bash}` }
  const tag = /^<([a-z][\w-]*)>/.exec(body)?.[1]
  if (tag === "local-command-caveat") return { kind: "skip", text: "" }
  if (tag === "local-command-stdout" || tag === "local-command-stderr" || tag === "bash-stdout" || tag === "bash-stderr") {
    const out = body.replace(/<\/?[a-z-]+>/g, "").trim()
    return out ? { kind: "note", note: "stdout", text: firstLine(out), detail: out } : { kind: "skip", text: "" }
  }
  if (tag === "task-notification") {
    return { kind: "note", note: "task", text: firstLine(inner(body, "summary") ?? "task notification"), detail: body }
  }
  if (body.startsWith("[Request interrupted")) return { kind: "note", note: "abort", text: "interrupted" }
  const origin = rec.origin?.kind
  if (rec.isMeta || (origin && origin !== "human")) return { kind: "note", note: "meta", text: firstLine(body), detail: body }
  return { kind: "user", text: body }
}

function flat(content: unknown): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((b) => (b?.type === "text" ? b.text : b?.type === "image" ? "[image]" : b?.type === "tool_reference" ? `[tool ${b.tool_name}]` : ""))
    .filter(Boolean)
    .join("\n")
}

function patches(res: any): ToolItem["patch"] {
  const files: { filePath: string; hunks: any[] }[] =
    Array.isArray(res.structuredPatch) && res.structuredPatch.length
      ? [{ filePath: res.filePath, hunks: res.structuredPatch }]
      : (res.bashEditDiff?.files ?? [])
  if (!files.length) return undefined
  return capPatch(
    files.map((f) => ({
      file: String(f.filePath ?? ""),
      hunks: (f.hunks ?? []).map((h: any) => ({ o: h.oldStart ?? 0, n: h.newStart ?? 0, lines: h.lines ?? [] })),
    })),
  )
}

const peeked = new Map<string, { key: string; meta: SessionMeta }>()

async function peek(path: string, size: number, updatedAt: number): Promise<SessionMeta> {
  const file = Bun.file(path)
  const tail = await file.slice(Math.max(0, size - 262144), size).text()
  const id = basename(path, ".jsonl")
  let title = unquote(lastMatch(tail, new RegExp(`"aiTitle":"${STRING}"`, "g")))
  let head = ""
  if (!title || size > 262144) head = await file.slice(0, Math.min(size, 393216)).text()
  if (!title) {
    title = unquote(lastMatch(head, new RegExp(`"aiTitle":"${STRING}"`, "g")))
    for (const line of title ? [] : head.split("\n")) {
      if (!line.includes('"type":"user"')) continue
      const rec = parse(line)
      if (rec?.type !== "user" || rec.isSidechain || rec.isCompactSummary) continue
      const content = rec.message?.content
      const prompt = classify(rec, typeof content === "string" ? content : flat(content))
      if (prompt.kind === "user") {
        title = firstLine(prompt.text, 80)
        break
      }
    }
  }
  const both = `${head}\n${tail}`
  return {
    source: "claude",
    id,
    title: title || id.slice(0, 8),
    path,
    updatedAt,
    cwd: unquote(lastMatch(both, new RegExp(`"cwd":"${STRING}"`, "g"))),
    branch: unquote(lastMatch(both, new RegExp(`"gitBranch":"${STRING}"`, "g"))) || undefined,
  }
}

export async function list(): Promise<SessionMeta[]> {
  const out: SessionMeta[] = []
  const dirs = await readdir(ROOT).catch(() => [] as string[])
  await Promise.all(
    dirs.map(async (dir) => {
      const names = await readdir(join(ROOT, dir)).catch(() => [] as string[])
      for (const name of names) {
        if (!name.endsWith(".jsonl")) continue
        const path = join(ROOT, dir, name)
        const s = await stat(path).catch(() => undefined)
        if (!s?.size) continue
        const key = `${s.mtimeMs}:${s.size}`
        let hit = peeked.get(path)
        if (hit?.key !== key) {
          hit = { key, meta: await peek(path, s.size, s.mtimeMs) }
          peeked.set(path, hit)
        }
        out.push(hit.meta)
      }
    }),
  )
  return out
}

export function agentPath(sessionPath: string, agent: string): string | undefined {
  if (!/^[\w-]+$/.test(agent)) return undefined
  return join(sessionPath.replace(/\.jsonl$/, ""), "subagents", `agent-${agent}.jsonl`)
}

export function open(path: string, id: string, sessionPath = path): Reader {
  const tail = new Tail(path)
  const items = new Map<string, Item>()
  const untitled = id.startsWith("/") ? basename(id) : id.slice(0, 8)
  const meta: SessionMeta = { source: "claude", id, title: untitled, path, updatedAt: 0 }
  const unlinked = new Set<string>()
  const metaFiles = new Set<string>()
  const subagents = join(sessionPath.replace(/\.jsonl$/, ""), "subagents")
  let touched = new Map<string, Item>()
  let metaChanged = false

  const put = (item: Item) => {
    items.set(item.id, item)
    touched.set(item.id, item)
  }
  const setMeta = <K extends keyof SessionMeta>(key: K, value: SessionMeta[K] | undefined) => {
    if (value === undefined || value === "" || meta[key] === value) return
    meta[key] = value
    metaChanged = true
  }
  const note = (id: string, t: number | undefined, kind: NoteKind, text: string, detail?: string) =>
    put({ id, t, k: "note", kind, text, detail })

  function prompt(rec: any, t: number | undefined, raw: string, images: number) {
    const p = classify(rec, raw)
    if (p.kind === "note") note(rec.uuid, t, p.note!, p.text, p.detail)
    else if (p.kind === "user" || images) {
      put({ id: rec.uuid, t, k: "user", text: p.text, images: images || undefined })
      if (meta.title === untitled && p.text) setMeta("title", firstLine(p.text, 80))
    }
  }

  function result(rec: any, block: any, t: number | undefined) {
    const tool = items.get(block.tool_use_id)
    if (tool?.k !== "tool") return
    const next: ToolItem = {
      ...tool,
      status: block.is_error ? "err" : "ok",
      out: flat(block.content),
      ms: t && tool.t ? Math.max(0, t - tool.t) : undefined,
    }
    const res = rec.toolUseResult
    if (res && typeof res === "object") {
      if (typeof res.agentId === "string") {
        next.agent = res.agentId
        unlinked.delete(tool.id)
      }
      const patch = patches(res)
      if (patch?.length) next.patch = patch
    }
    put(next)
  }

  function handle(rec: any) {
    if (rec.type === "ai-title") return setMeta("title", rec.aiTitle)
    if (rec.isSidechain && path === sessionPath) return
    const t = Date.parse(rec.timestamp) || undefined
    setMeta("cwd", rec.cwd)
    setMeta("branch", rec.gitBranch)
    if (rec.type === "assistant") {
      const model = rec.message?.model
      if (model && model !== "<synthetic>") setMeta("model", model)
      const blocks: any[] = rec.message?.content ?? []
      blocks.forEach((b, i) => {
        const id = `${rec.uuid}:${i}`
        if (b.type === "text" && b.text?.trim()) put({ id, t, k: "text", text: b.text })
        else if (b.type === "thinking" && b.thinking?.trim()) put({ id, t, k: "think", text: b.thinking, ms: rec.thinkingDurationMs })
        else if (b.type === "tool_use" && !items.has(b.id)) {
          put({ id: b.id, t, k: "tool", name: b.name, input: b.input, status: "run" })
          if (AGENT_TOOLS.has(b.name)) unlinked.add(b.id)
        }
      })
    } else if (rec.type === "user") {
      const content = rec.message?.content
      if (rec.isCompactSummary) return note(rec.uuid, t, "summary", "summary of the earlier conversation", flat(content))
      if (typeof content === "string") return prompt(rec, t, content, 0)
      let text = ""
      let images = 0
      for (const b of content ?? []) {
        if (b.type === "tool_result") result(rec, b, t)
        else if (b.type === "text") text += (text ? "\n" : "") + b.text
        else if (b.type === "image") images++
      }
      if (text || images) prompt(rec, t, text, images)
    } else if (rec.type === "system") {
      if (rec.subtype === "compact_boundary") {
        const m = rec.compactMetadata
        const span = m?.preTokens && m?.postTokens ? `, ${m.preTokens.toLocaleString("en-US")} to ${m.postTokens.toLocaleString("en-US")} tokens` : ""
        note(rec.uuid, t, "compact", `context compacted${span}`)
      } else if (rec.subtype === "api_error") note(rec.uuid, t, "error", firstLine(String(rec.content ?? "api error")), rec.content)
      else if (rec.subtype === "away_summary" && rec.content) note(rec.uuid, t, "recap", firstLine(rec.content), rec.content)
    }
  }

  async function link() {
    const names = await readdir(subagents).catch(() => [] as string[])
    for (const name of names) {
      if (!name.endsWith(".meta.json") || metaFiles.has(name)) continue
      const info = parse(await Bun.file(join(subagents, name)).text().catch(() => ""))
      if (!info) continue
      metaFiles.add(name)
      const tool = items.get(info.toolUseId)
      if (tool?.k !== "tool" || tool.agent) continue
      put({ ...tool, agent: name.slice("agent-".length, -".meta.json".length) })
      unlinked.delete(tool.id)
    }
  }

  return {
    meta,
    items,
    watch: [path],
    async poll() {
      touched = new Map()
      metaChanged = false
      const { lines, reset } = await tail.read()
      if (reset) {
        items.clear()
        unlinked.clear()
        metaFiles.clear()
      }
      for (const line of lines) {
        if (!RELEVANT.test(line)) continue
        const rec = parse(line)
        if (rec) handle(rec)
      }
      if (unlinked.size) await link()
      const s = await stat(path).catch(() => undefined)
      if (s && s.mtimeMs !== meta.updatedAt) setMeta("updatedAt", s.mtimeMs)
      return { items: [...touched.values()], meta: metaChanged, reset }
    },
  }
}
