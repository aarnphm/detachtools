import type { Item, SessionMeta } from "./types"

export interface Term {
  text: string
  cased: boolean
}

export interface ItemHit {
  id: string
  k: Item["k"]
  snippet: string
}

export interface SessionHit {
  source: SessionMeta["source"]
  id: string
  hits: number
  snippet: string
}

const SNIPPET = 96
const BUDGET = 160_000_000

export function parseQuery(q: string): Term[] {
  const terms: Term[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const text = m[1] ?? m[2]
    const cased = text !== text.toLowerCase()
    terms.push({ text: cased ? text : text.toLowerCase(), cased })
  }
  return terms
}

function strings(value: unknown, out: string[], depth = 0) {
  if (typeof value === "string") out.push(value)
  else if (value && typeof value === "object" && depth < 5) for (const v of Object.values(value)) strings(v, out, depth + 1)
}

export function textOf(item: Item): string {
  if (item.k === "user" || item.k === "text" || item.k === "think") return item.text
  if (item.k === "note") return item.detail ? `${item.text}\n${item.detail}` : item.text
  const parts = [item.name]
  strings(item.input, parts)
  if (item.out) parts.push(item.out)
  for (const file of item.patch ?? []) {
    parts.push(file.file)
    for (const hunk of file.hunks) parts.push(hunk.lines.join("\n"))
  }
  return parts.join("\n")
}

interface Entry {
  id: string
  k: Item["k"]
  text: string
  lower: string
}

const entries = new WeakMap<Item, Entry>()

function entry(item: Item): Entry {
  let hit = entries.get(item)
  if (!hit) {
    const text = textOf(item)
    hit = { id: item.id, k: item.k, text, lower: text.toLowerCase() }
    entries.set(item, hit)
  }
  return hit
}

function first(e: Entry, terms: Term[]): number {
  let at = -1
  for (const term of terms) {
    const found = (term.cased ? e.text : e.lower).indexOf(term.text)
    if (found < 0) return -1
    if (at < 0) at = found
  }
  return at
}

function snip(text: string, at: number): string {
  const from = Math.max(0, at - 24)
  const cut = text.slice(from, from + SNIPPET).replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, "").replace(/\s+/g, " ").trim()
  return `${from > 0 ? "…" : ""}${cut}${from + SNIPPET < text.length ? "…" : ""}`
}

export function searchItems(items: Iterable<Item>, terms: Term[]): ItemHit[] {
  const out: ItemHit[] = []
  if (!terms.length) return out
  for (const item of items) {
    const e = entry(item)
    const at = first(e, terms)
    if (at >= 0) out.push({ id: e.id, k: e.k, snippet: snip(e.text, at) })
  }
  return out
}

interface Cached {
  key: string
  items: Item[]
  size: number
}

const cache = new Map<string, Cached>()
let held = 0

export function remember(path: string, key: string, items: Item[]): void {
  forget(path)
  const size = items.reduce((n, item) => n + textOf(item).length, 0)
  cache.set(path, { key, items, size })
  held += size
  for (const [oldest, value] of cache) {
    if (held <= BUDGET || oldest === path) break
    cache.delete(oldest)
    held -= value.size
  }
}

export function recall(path: string, key: string): Item[] | undefined {
  const hit = cache.get(path)
  if (!hit) return undefined
  if (hit.key !== key) {
    forget(path)
    return undefined
  }
  cache.delete(path)
  cache.set(path, hit)
  return hit.items
}

function forget(path: string) {
  const old = cache.get(path)
  if (!old) return
  cache.delete(path)
  held -= old.size
}

export const RG = process.env.TRANSCRIPTS_RG || Bun.which("rg") || undefined

export async function filesWith(terms: Term[], roots: { dir: string; depth?: number }[]): Promise<Set<string> | undefined> {
  if (!RG) return undefined
  let files: Set<string> | undefined
  for (const term of terms) {
    const pattern = JSON.stringify(term.text).slice(1, -1)
    const base = ["--files-with-matches", "--fixed-strings", "--no-messages", "--null", term.cased ? "--case-sensitive" : "--ignore-case", "-e", pattern]
    const found = new Set<string>()
    const runs: string[][] = files
      ? [[...base, "--", ...files]]
      : roots.map((root) => [...base, "--glob", "*.jsonl", ...(root.depth ? ["--max-depth", String(root.depth)] : []), "--", root.dir])
    if (files && !files.size) return files
    await Promise.all(
      runs.map(async (args) => {
        const proc = Bun.spawn([RG!, ...args], { stdout: "pipe", stderr: "ignore" })
        const text = await new Response(proc.stdout).text()
        await proc.exited
        for (const path of text.split("\0")) if (path) found.add(path)
      }),
    )
    files = found
  }
  return files
}
