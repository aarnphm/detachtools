import type { Item, SessionMeta } from "./types"

export type Mode = "terms" | "regex" | "fuzzy"

export interface Term {
  text: string
  cased: boolean
}

export interface Line {
  n: number
  text: string
  ranges: [number, number][]
}

export interface Group {
  id: string
  k: Item["k"]
  lines: Line[]
  more: number
}

export interface Found {
  total: number
  items: number
  groups: Group[]
  ranked: boolean
  truncated: boolean
}

export interface SessionHit {
  source: SessionMeta["source"]
  id: string
  hits: number
  total: number
  snippet: string
  lines?: (Line & { id: string; k: Item["k"] })[]
}

export interface Query {
  mode: Mode
  terms: Term[]
  patterns: RegExp[]
  literal: boolean
  keep(item: Item): boolean
}

const BUDGET = 160_000_000
const WINDOW = 220
const LEAD = 60
const PER_ITEM = 6
const MAX_LINES = 500
const FUZZY_LINE = 300
const FUZZY_KEEP = 200
const TIME_MS = 1500
const ANSI = /\x1b(?:\[[0-9;:?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g
const KINDS: Record<string, Item["k"]> = {
  user: "user",
  prompt: "user",
  reply: "text",
  text: "text",
  assistant: "text",
  thinking: "think",
  think: "think",
  tool: "tool",
  tools: "tool",
  note: "note",
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

function toolLabel(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  return (mcp ? mcp[2] : name.slice(name.lastIndexOf("/") + 1)).toLowerCase()
}

export function parseTerms(q: string, forceCase = false): Term[] {
  const terms: Term[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const text = m[1] ?? m[2]
    const cased = forceCase || text !== text.toLowerCase()
    terms.push({ text: cased ? text : text.toLowerCase(), cased })
  }
  return terms
}

function filterOf(spec: string): (item: Item) => boolean {
  const include: string[] = []
  const exclude: string[] = []
  for (const token of spec.toLowerCase().split(/[\s,]+/).filter(Boolean)) {
    if (/^[-!]/.test(token)) exclude.push(token.slice(1))
    else include.push(token)
  }
  const match = (item: Item, token: string) => (KINDS[token] ? item.k === KINDS[token] : item.k === "tool" && toolLabel(item.name).includes(token))
  return (item) => (!include.length || include.some((t) => match(item, t))) && !exclude.some((t) => match(item, t))
}

export function compile(params: URLSearchParams): Query | { error: string } {
  const raw = (params.get("q") ?? "").trim()
  const mode: Mode = params.get("mode") === "regex" ? "regex" : params.get("mode") === "fuzzy" ? "fuzzy" : "terms"
  const forceCase = params.get("case") === "1"
  const word = params.get("word") === "1"
  const keep = filterOf(params.get("filter") ?? "")
  if (mode === "regex") {
    try {
      return { mode, terms: [], patterns: raw ? [new RegExp(raw, forceCase || raw !== raw.toLowerCase() ? "g" : "gi")] : [], literal: false, keep }
    } catch (error) {
      return { error: (error as Error).message }
    }
  }
  const terms = parseTerms(raw, forceCase)
  const edge = word ? "\\b" : ""
  const patterns = mode === "terms" ? terms.map((t) => new RegExp(edge + escape(t.text) + edge, t.cased ? "g" : "gi")) : []
  return { mode, terms, patterns, literal: mode === "terms" && !word, keep }
}

export const isEmpty = (q: Query) => (q.mode === "regex" ? !q.patterns.length : !q.terms.some((t) => t.text.length >= 2))

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
  text: string
  lower: string
  lines?: string[]
}

const entries = new WeakMap<Item, Entry>()

function entry(item: Item): Entry {
  let hit = entries.get(item)
  if (!hit) {
    const text = textOf(item).replace(ANSI, "").replace(/\r\n?/g, "\n")
    hit = { text, lower: text.toLowerCase() }
    entries.set(item, hit)
  }
  return hit
}

function clip(n: number, text: string, ranges: [number, number][]): Line {
  if (text.length <= WINDOW) return { n, text, ranges }
  const from = Math.max(0, ranges[0][0] - LEAD)
  const to = Math.min(text.length, from + WINDOW)
  const lead = from > 0 ? "…" : ""
  const shifted = ranges
    .filter(([start]) => start >= from && start < to)
    .map(([start, end]): [number, number] => [start - from + lead.length, Math.min(end, to) - from + lead.length])
  return { n, text: `${lead}${text.slice(from, to)}${to < text.length ? "…" : ""}`, ranges: shifted }
}

function spans(line: string, patterns: RegExp[]): [number, number][] {
  const out: [number, number][] = []
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(line); m; m = pattern.exec(line)) {
      if (m[0].length) out.push([m.index, m.index + m[0].length])
      else pattern.lastIndex++
    }
  }
  return out.length > 1 ? merge(out) : out
}

function merge(ranges: [number, number][]): [number, number][] {
  ranges.sort((a, b) => a[0] - b[0])
  const out: [number, number][] = [ranges[0]]
  for (const [start, end] of ranges.slice(1)) {
    const last = out[out.length - 1]
    if (start <= last[1]) last[1] = Math.max(last[1], end)
    else out.push([start, end])
  }
  return out
}

const boundary = (text: string, at: number) => at === 0 || !/[a-z0-9]/i.test(text[at - 1])

function fuzzy(line: string, hay: string, term: string): { score: number; at: number[] } | undefined {
  let from = 0
  let end = -1
  for (const ch of term) {
    const found = hay.indexOf(ch, from)
    if (found < 0) return undefined
    end = found
    from = found + 1
  }
  const at: number[] = new Array(term.length)
  let cursor = end
  for (let i = term.length - 1; i >= 0; i--) {
    cursor = hay.lastIndexOf(term[i], cursor)
    at[i] = cursor
    cursor--
  }
  let score = 0
  for (let i = 0; i < at.length; i++) {
    score += 16
    if (boundary(line, at[i])) score += 10
    if (i > 0) score += at[i] === at[i - 1] + 1 ? 8 : -Math.min(12, at[i] - at[i - 1] - 1)
  }
  return { score, at }
}

function runs(at: number[]): [number, number][] {
  return merge(at.map((i): [number, number] => [i, i + 1]))
}

export function searchLines(items: Iterable<Item>, q: Query, perItem = PER_ITEM, max = MAX_LINES): Found {
  const found: Found = { total: 0, items: 0, groups: [], ranked: q.mode === "fuzzy", truncated: false }
  if (isEmpty(q)) return found
  const started = Date.now()
  const ranked: { score: number; group: Group }[] = []
  let shipped = 0
  for (const item of items) {
    if (!q.keep(item)) continue
    if (Date.now() - started > TIME_MS) {
      found.truncated = true
      break
    }
    const e = entry(item)
    if (q.mode === "terms" && !q.terms.every((t) => (t.cased ? e.text : e.lower).includes(t.text))) continue
    if (q.mode === "terms" && !q.patterns.every((p) => ((p.lastIndex = 0), p.test(e.text)))) continue
    e.lines ??= e.text.split("\n")
    if (q.mode === "fuzzy") {
      for (let n = 0; n < e.lines.length; n++) {
        const line = e.lines[n]
        if (!line || line.length > FUZZY_LINE) continue
        const lower = line.toLowerCase()
        let score = 0
        const at: number[] = []
        for (const term of q.terms) {
          const hit = fuzzy(line, term.cased ? line : lower, term.text)
          if (!hit) {
            score = -1
            break
          }
          score += hit.score
          at.push(...hit.at)
        }
        if (score < 0) continue
        found.total++
        ranked.push({ score, group: { id: item.id, k: item.k, lines: [{ n: n + 1, text: line, ranges: runs(at) }], more: 0 } })
      }
      continue
    }
    const group: Group = { id: item.id, k: item.k, lines: [], more: 0 }
    for (let n = 0; n < e.lines.length; n++) {
      const line = e.lines[n]
      if (!line) continue
      const ranges = spans(line, q.patterns)
      if (!ranges.length) continue
      found.total++
      if (group.lines.length < perItem && shipped < max) {
        group.lines.push(clip(n + 1, line, ranges))
        shipped++
      } else group.more++
    }
    if (!group.lines.length && !group.more) continue
    found.items++
    if (group.lines.length) found.groups.push(group)
    else found.truncated = true
  }
  if (q.mode === "fuzzy") {
    ranked.sort((a, b) => b.score - a.score)
    found.groups = ranked.slice(0, FUZZY_KEEP).map((r) => r.group)
    found.items = new Set(ranked.map((r) => r.group.id)).size
    found.truncated ||= ranked.length > FUZZY_KEEP
  } else found.truncated ||= shipped >= max && found.total > shipped
  return found
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
