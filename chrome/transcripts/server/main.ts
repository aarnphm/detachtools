import { type FSWatcher, watch } from "node:fs"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import * as argon from "./argon"
import { build } from "./build"
import { EXT, PORT, ROOT } from "./paths"
import * as claude from "./claude"
import * as codex from "./codex"
import { type SessionHit, filesWith, parseQuery, recall, remember, searchItems } from "./search"
import type { Item, Reader, SessionMeta, SessionsDelta, Snapshot, Source } from "./types"
import { slim } from "./util"

const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`])
const LIST_LIMIT = 400
const IDLE_CLOSE_MS = 60_000
const TICK_MS = 2000
const SEARCH_LIMIT = 80

const adapters = { claude, argon, codex } satisfies Record<Source, { list(): Promise<SessionMeta[]>; ROOT: string }>
const isSource = (s: string): s is Source => s in adapters

type Send = (event: string, data: unknown) => void

let sessions = new Map<string, SessionMeta>()
const key = (m: { source: string; id: string }) => `${m.source}/${m.id}`
const listeners = new Set<Send>()
let scanning: Promise<void> | undefined
let rescan = false

async function scan() {
  if (scanning) {
    rescan = true
    return scanning
  }
  scanning = (async () => {
    do {
      rescan = false
      const lists = await Promise.all(Object.values(adapters).map((a) => a.list().catch(() => [] as SessionMeta[])))
      const next = new Map(
        lists
          .flat()
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .slice(0, LIST_LIMIT)
          .map((m) => [key(m), m]),
      )
      const delta: SessionsDelta = { upsert: [], remove: [] }
      for (const [k, m] of next) {
        const old = sessions.get(k)
        if (!old || old.updatedAt !== m.updatedAt || old.title !== m.title) delta.upsert.push(m)
      }
      for (const k of sessions.keys()) if (!next.has(k)) delta.remove.push(k)
      sessions = next
      if (delta.upsert.length || delta.remove.length) for (const send of listeners) send("sessions", delta)
    } while (rescan)
  })().finally(() => {
    scanning = undefined
  })
  return scanning
}

let scanTimer: ReturnType<typeof setTimeout> | undefined
function scheduleScan() {
  if (scanTimer) return
  scanTimer = setTimeout(() => {
    scanTimer = undefined
    void scan()
  }, 400)
}

for (const adapter of Object.values(adapters)) {
  try {
    watch(adapter.ROOT, { recursive: true }, (_event, name) => {
      if (name && /\.(jsonl|db|db-wal)$/.test(name)) scheduleScan()
    })
  } catch {}
}
setInterval(scheduleScan, 15_000)

async function sniff(path: string): Promise<Source | undefined> {
  if (path.endsWith(".db")) return "argon"
  if (!path.endsWith(".jsonl")) return undefined
  const head = await Bun.file(path).slice(0, 4096).text().catch(() => "")
  if (!head) return undefined
  return head.includes('"session_meta"') || head.includes('"payload"') ? "codex" : "claude"
}

async function locate(source: Source, id: string): Promise<string | undefined> {
  if (id.startsWith("/")) return (await sniff(id)) === source && (await stat(id).catch(() => undefined)) ? id : undefined
  if (!sessions.size) await scan()
  return sessions.get(`${source}/${id}`)?.path
}

async function resolve(q: string): Promise<{ source: Source; id: string } | undefined> {
  const text = q.trim().replace(/^~(?=\/)/, process.env.HOME ?? "~")
  if (text.startsWith("/")) {
    const source = await sniff(text)
    if (!source || !(await stat(text).catch(() => undefined))) return undefined
    const known = [...sessions.values()].find((m) => m.path === text)
    return known ? { source: known.source, id: known.id } : { source, id: text }
  }
  await scan()
  const needle = text.toLowerCase()
  if (needle.length < 4) return undefined
  const hits = [...sessions.values()].filter((m) => m.id.toLowerCase().startsWith(needle))
  return hits.length ? { source: hits[0].source, id: hits[0].id } : undefined
}

class Live {
  subs = new Set<Send>()
  watchers: FSWatcher[] = []
  timer: ReturnType<typeof setInterval>
  closing: ReturnType<typeof setTimeout> | undefined
  busy: Promise<void> | undefined
  again = false

  constructor(readonly name: string, readonly reader: Reader) {
    for (const path of reader.watch) {
      try {
        this.watchers.push(watch(path, () => void this.tick()))
      } catch {}
    }
    this.timer = setInterval(() => void this.tick(), TICK_MS)
  }

  snapshot(): Snapshot {
    return { meta: this.reader.meta, items: [...this.reader.items.values()].map(slim) }
  }

  tick(): Promise<void> {
    if (this.busy) {
      this.again = true
      return this.busy
    }
    this.busy = (async () => {
      do {
        this.again = false
        const change = await this.reader.poll().catch(() => undefined)
        if (!change) continue
        if (change.reset) this.emit("snapshot", this.snapshot())
        else {
          if (change.items.length) this.emit("upsert", { items: change.items.map(slim) })
          if (change.meta) this.emit("meta", this.reader.meta)
        }
      } while (this.again)
    })().finally(() => {
      this.busy = undefined
    })
    return this.busy
  }

  emit(event: string, data: unknown) {
    for (const send of this.subs) send(event, data)
  }

  release(send: Send) {
    this.subs.delete(send)
    if (this.subs.size) return
    this.closing = setTimeout(() => {
      if (this.subs.size) return
      clearInterval(this.timer)
      for (const w of this.watchers) w.close()
      lives.delete(this.name)
    }, IDLE_CLOSE_MS)
  }
}

const lives = new Map<string, Live>()

async function live(source: Source, id: string, agent: string | null): Promise<Live | undefined> {
  const name = `${source}/${id}${agent ? `#${agent}` : ""}`
  const hit = lives.get(name)
  if (hit) {
    clearTimeout(hit.closing)
    await hit.tick()
    return hit
  }
  const path = await locate(source, id)
  if (!path) return undefined
  let reader: Reader
  if (source === "claude") {
    const file = agent ? claude.agentPath(path, agent) : path
    if (!file || !(await stat(file).catch(() => undefined))) return undefined
    reader = claude.open(file, id, path)
  } else if (agent) return undefined
  else reader = adapters[source].open(path, id)
  const created = new Live(name, reader)
  lives.set(name, created)
  await created.tick()
  created.release(() => {})
  return created
}

async function itemsOf(meta: SessionMeta): Promise<Item[]> {
  const open = lives.get(key(meta))
  if (open) {
    await open.tick()
    return [...open.reader.items.values()]
  }
  const stamp = String(meta.updatedAt)
  const kept = recall(meta.path, stamp)
  if (kept) return kept
  const reader = adapters[meta.source].open(meta.path, meta.id)
  await reader.poll().catch(() => undefined)
  const items = [...reader.items.values()]
  remember(meta.path, stamp, items)
  return items
}

async function searchAll(q: string, signal: AbortSignal) {
  const terms = parseQuery(q)
  if (!terms.some((t) => t.text.length >= 2)) return { sessions: [], scanned: 0, total: sessions.size }
  await scan()
  const all = [...sessions.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  const files = await filesWith(terms, [{ dir: claude.ROOT, depth: 2 }, { dir: join(codex.ROOT, "sessions") }])
  const candidates = (files ? all.filter((m) => m.source === "argon" || files.has(m.path)) : all).slice(0, SEARCH_LIMIT)
  const found: SessionHit[] = []
  for (const meta of candidates) {
    if (signal.aborted) break
    const hits = searchItems(await itemsOf(meta), terms)
    if (hits.length) found.push({ source: meta.source, id: meta.id, hits: hits.length, snippet: hits[0].snippet })
  }
  return { sessions: found, scanned: candidates.length, total: all.length }
}

const encoder = new TextEncoder()

function sse(req: Request, headers: HeadersInit, start: (send: Send) => (() => void) | void): Response {
  let stop: (() => void) | void
  let beat: ReturnType<typeof setInterval>
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {}
      }
      stop = start((event, data) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      beat = setInterval(() => write(": beat\n\n"), 15_000)
      req.signal.addEventListener("abort", () => {
        clearInterval(beat)
        stop?.()
      })
    },
    cancel() {
      clearInterval(beat)
      stop?.()
    },
  })
  return new Response(stream, { headers: { ...headers, "content-type": "text/event-stream", "cache-control": "no-store" } })
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".json": "application/json",
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const origin = req.headers.get("origin")
  const extension = origin?.startsWith("chrome-extension://") ?? false
  if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("forbidden host", { status: 403 })
  if (origin && !extension && !HOSTS.has(origin.replace(/^http:\/\//, ""))) return new Response("forbidden origin", { status: 403 })
  const cors: Record<string, string> = extension ? { "access-control-allow-origin": origin!, vary: "origin" } : {}
  const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { ...cors, "cache-control": "no-store" } })

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { ...cors, "access-control-allow-methods": "GET, POST", "access-control-allow-headers": "content-type" } })
  }

  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent)
  if (parts[0] === "api") {
    if (parts[1] === "notify" && req.method === "POST") {
      await scan()
      await Promise.all([...lives.values()].map((l) => l.tick()))
      return json({ ok: true })
    }
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405)
    if (parts[1] === "health") return json({ ok: true, pid: process.pid })
    if (parts[1] === "sessions" && parts[2] === "stream") {
      await scan()
      return sse(req, cors, (send) => {
        send("sessions", { upsert: [...sessions.values()], remove: [], full: true })
        listeners.add(send)
        return () => listeners.delete(send)
      })
    }
    if (parts[1] === "sessions") {
      await scan()
      return json({ sessions: [...sessions.values()] })
    }
    if (parts[1] === "search" && parts.length === 2) return json(await searchAll(url.searchParams.get("q") ?? "", req.signal))
    if (parts[1] === "resolve") {
      const hit = await resolve(url.searchParams.get("q") ?? "")
      return json({ hit: hit ?? null })
    }
    const [, verb, source, id, itemId] = parts
    if (!source || !id || !isSource(source)) return json({ error: "bad request" }, 400)
    const session = await live(source, id, url.searchParams.get("agent"))
    if (!session) return json({ error: "not found" }, 404)
    if (verb === "stream") {
      return sse(req, cors, (send) => {
        clearTimeout(session.closing)
        send("snapshot", session.snapshot())
        session.subs.add(send)
        return () => session.release(send)
      })
    }
    if (verb === "items") return json(session.snapshot())
    if (verb === "search") return json({ hits: searchItems(session.reader.items.values(), parseQuery(url.searchParams.get("q") ?? "")) })
    if (verb === "item") {
      const item = session.reader.items.get(itemId ?? "")
      return item ? json(item) : json({ error: "not found" }, 404)
    }
    return json({ error: "not found" }, 404)
  }

  const name = url.pathname === "/" ? "/view.html" : url.pathname
  const ext = name.slice(name.lastIndexOf("."))
  if (name.includes("..") || !TYPES[ext]) return new Response("not found", { status: 404 })
  const file = Bun.file(join(EXT, name))
  if (!(await file.exists())) return new Response("not found", { status: 404 })
  return new Response(file, { headers: { "content-type": TYPES[ext], "cache-control": "no-store" } })
}

await build()
if (process.argv.includes("--build")) process.exit(0)
if (process.argv.includes("--watch")) {
  watch(join(ROOT, "ui"), { recursive: true }, () => void build().catch((e) => console.error(e)))
}

Bun.serve({ hostname: "127.0.0.1", port: PORT, idleTimeout: 255, fetch: (req) => handle(req).catch((e) => new Response(String(e), { status: 500 })) })
console.log(`transcripts: http://127.0.0.1:${PORT}`)
void scan()
