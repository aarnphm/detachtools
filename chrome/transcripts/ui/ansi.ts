import { type Child, h } from "./dom"

const ESCAPE = /\x1b(?:\[([0-9;:?]*)[ -/]*([@-~])|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[@-Z\\-_])/g
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f]/g
const OVERWRITTEN = /[^\n]*\r(?=[^\n])/g

interface Style {
  bold: boolean
  dim: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  inverse: boolean
  fg: number | undefined
}

const plainStyle = (): Style => ({ bold: false, dim: false, italic: false, underline: false, strike: false, inverse: false, fg: undefined })

const normalize = (text: string) => text.replace(/\r\n/g, "\n").replace(OVERWRITTEN, "")

export function plain(text: string): string {
  return normalize(text).replace(ESCAPE, "").replace(CONTROL, "")
}

function apply(style: Style, params: string) {
  const codes = params.split(/[;:]/).map((p) => Number(p) || 0)
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]
    if (code === 0) Object.assign(style, plainStyle())
    else if (code === 1) style.bold = true
    else if (code === 2) style.dim = true
    else if (code === 3) style.italic = true
    else if (code === 4) style.underline = true
    else if (code === 7) style.inverse = true
    else if (code === 9) style.strike = true
    else if (code === 22) style.bold = style.dim = false
    else if (code === 23) style.italic = false
    else if (code === 24) style.underline = false
    else if (code === 27) style.inverse = false
    else if (code === 29) style.strike = false
    else if (code >= 30 && code <= 37) style.fg = code - 30
    else if (code >= 90 && code <= 97) style.fg = code - 82
    else if (code === 39) style.fg = undefined
    else if (code === 38 || code === 48) {
      const mode = codes[i + 1]
      const indexed = mode === 5 ? codes[i + 2] : undefined
      i += mode === 5 ? 2 : mode === 2 ? 4 : 0
      if (code === 38) style.fg = indexed !== undefined && indexed < 16 ? indexed : undefined
    }
  }
}

function classes(style: Style): string {
  const out: string[] = []
  if (style.bold) out.push("a-bold")
  if (style.dim) out.push("a-dim")
  if (style.italic) out.push("a-italic")
  if (style.underline) out.push("a-underline")
  if (style.strike) out.push("a-strike")
  if (style.inverse) out.push("a-inverse")
  if (style.fg !== undefined) out.push(`a-fg${style.fg}`)
  return out.join(" ")
}

export function ansi(text: string): Child[] {
  const source = normalize(text)
  if (!source.includes("\x1b")) return [source.replace(CONTROL, "")]
  const out: Child[] = []
  const style = plainStyle()
  let last = 0
  const push = (chunk: string) => {
    const clean = chunk.replace(CONTROL, "")
    if (!clean) return
    const cls = classes(style)
    out.push(cls ? h("span", { class: cls }, clean) : clean)
  }
  for (const match of source.matchAll(ESCAPE)) {
    const at = match.index ?? 0
    push(source.slice(last, at))
    last = at + match[0].length
    if (match[2] === "m") apply(style, match[1] ?? "")
  }
  push(source.slice(last))
  return out
}
