import type { Hunk, Item, Patch } from "./types"

const decoder = new TextDecoder()

export class Tail {
  offset = 0
  constructor(readonly path: string) {}

  async read(): Promise<{ lines: string[]; reset: boolean }> {
    const file = Bun.file(this.path)
    const size = file.size
    const reset = size < this.offset
    if (reset) this.offset = 0
    if (size === this.offset) return { lines: [], reset }
    const buf = new Uint8Array(await file.slice(this.offset, size).arrayBuffer())
    const end = buf.lastIndexOf(10)
    if (end < 0) return { lines: [], reset }
    this.offset += end + 1
    return { lines: decoder.decode(buf.subarray(0, end)).split("\n"), reset }
  }
}

export function parse(line: string): any {
  try {
    return JSON.parse(line)
  } catch {
    return undefined
  }
}

export function unquote(raw: string | undefined): string | undefined {
  return raw === undefined ? undefined : (parse(`"${raw}"`) ?? raw)
}

export function lastMatch(text: string, re: RegExp): string | undefined {
  let hit: string | undefined
  for (const m of text.matchAll(re)) hit = m[1]
  return hit
}

export function firstLine(text: string, max = 96): string {
  const line = text.trim().split("\n", 1)[0] ?? ""
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

const PATCH_LINES = 800

export function capPatch(files: { file: string; hunks: Hunk[] }[]): Patch[] {
  let left = PATCH_LINES
  const out: Patch[] = []
  for (const f of files) {
    const hunks: Hunk[] = []
    for (const h of f.hunks) {
      if (left <= 0) break
      const lines = h.lines.slice(0, left)
      left -= lines.length
      hunks.push({ o: h.o, n: h.n, lines })
    }
    if (hunks.length) out.push({ file: f.file, hunks })
  }
  return out
}

export function parseUnified(diff: string): Hunk[] {
  const hunks: Hunk[] = []
  for (const line of diff.split("\n")) {
    const head = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line)
    if (head) hunks.push({ o: Number(head[1]), n: Number(head[2]), lines: [] })
    else if (hunks.length && /^[ +-]/.test(line)) hunks[hunks.length - 1].lines.push(line)
  }
  return hunks
}

const OUT_MAX = 8000
const IN_MAX = 4000

function slimValue(v: unknown, depth: number): unknown {
  if (typeof v === "string") return v.length > IN_MAX ? `${v.slice(0, IN_MAX)}\n… ${v.length - IN_MAX} more characters` : v
  if (depth > 4 || v === null || typeof v !== "object") return v
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => slimValue(x, depth + 1))
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, slimValue(x, depth + 1)]))
}

export function slim(item: Item): Item {
  if (item.k === "tool") {
    const out = item.out
    const cut = out !== undefined && out.length > OUT_MAX
    return { ...item, input: slimValue(item.input, 0), out: cut ? out.slice(0, OUT_MAX) : out, outLen: cut ? out.length : undefined }
  }
  if (item.k === "note" && item.detail && item.detail.length > OUT_MAX) {
    return { ...item, detail: `${item.detail.slice(0, OUT_MAX)}\n… ${item.detail.length - OUT_MAX} more characters` }
  }
  return item
}
