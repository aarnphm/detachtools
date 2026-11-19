import { type Child, h } from "./dom"

const FENCE = /^(\s{0,3})(`{3,}|~{3,})\s*([^\s`]*)/
const HEADING = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/
const RULE = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/
const QUOTE = /^\s{0,3}>\s?/
const BULLET = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/
const NOTE_DEF = /^\[\^([^\]\s]+)\]:\s?(.*)$/
const NOTE_MORE = /^(?: {2,}|\t)\S/
const TABLE_SEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

const INLINE = new RegExp(
  [
    /(`+)(?!`)([\s\S]*?[^`])\1(?!`)/,
    /\\([\\`*_{}[\]()#+\-.!~|<>$])/,
    /(!?)\[((?:[^[\]\\]|\\.|\[[^[\]]*\])*)\]\(\s*<?([^\s<>()]*(?:\([^\s<>()]*\)[^\s<>()]*)*)>?(?:\s+"[^"]*")?\s*\)/,
    /<((?:https?:\/\/|mailto:)[^\s<>]+)>/,
    /\b(https?:\/\/[^\s<>`]*[^\s<>`.,;:!?'")\]}*])/,
    /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/,
    /(?<![\w_])__(?=\S)([\s\S]+?)(?<=\S)__(?![\w_])/,
    /(?<![*\w])\*(?=[^\s*])((?:[^*\n]|\*\*[^*\n]+\*\*)+?)(?<=[^\s*])\*(?!\*)/,
    /(?<![\w_])_(?=[^\s_])([^_\n]+?)(?<=[^\s_])_(?![\w_])/,
    /~~(?=\S)([\s\S]+?)(?<=\S)~~/,
    /\[\^([^\]\s]+)\]/,
  ]
    .map((r) => r.source)
    .join("|"),
  "g",
)

interface Notes {
  prefix: string
  defs: Map<string, string[]>
  order: string[]
  calls: Map<string, number>
}

let notes: Notes | undefined
let serial = 0

export function markdown(src: string): DocumentFragment {
  const out = document.createDocumentFragment()
  const { lines, defs } = extractNotes(src.replace(/\r\n?/g, "\n").split("\n"))
  const outer = notes
  notes = defs.size ? { prefix: `fn${++serial}`, defs, order: [], calls: new Map() } : undefined
  try {
    blocks(lines, out)
    if (notes) out.append(noteList(notes))
  } finally {
    notes = outer
  }
  return out
}

function extractNotes(lines: string[]): { lines: string[]; defs: Map<string, string[]> } {
  const rest: string[] = []
  const defs = new Map<string, string[]>()
  let fence: string | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const mark = FENCE.exec(line)
    if (fence) {
      rest.push(line)
      if (mark && mark[2][0] === fence[0] && mark[2].length >= fence.length && !mark[3]) fence = undefined
      continue
    }
    if (mark) {
      fence = mark[2]
      rest.push(line)
      continue
    }
    const def = NOTE_DEF.exec(line)
    if (!def) {
      rest.push(line)
      continue
    }
    const body = [def[2]]
    while (i + 1 < lines.length) {
      const next = lines[i + 1]
      if (NOTE_MORE.test(next)) body.push(next.replace(/^(?: {1,4}|\t)/, ""))
      else if (!next.trim() && i + 2 < lines.length && NOTE_MORE.test(lines[i + 2])) body.push("")
      else break
      i++
    }
    if (!defs.has(def[1])) defs.set(def[1], body)
  }
  return { lines: rest, defs }
}

function noteRef(id: string, raw: string): Child {
  if (!notes?.defs.has(id)) return raw
  let at = notes.order.indexOf(id)
  if (at < 0) at = notes.order.push(id) - 1
  const call = (notes.calls.get(id) ?? 0) + 1
  notes.calls.set(id, call)
  const target = `${notes.prefix}-${at + 1}`
  return h("sup", { class: "fn-ref" }, h("a", { href: `#${target}`, id: `${target}-ref${call}`, "data-jump": target, "aria-label": `footnote ${at + 1}` }, String(at + 1)))
}

function noteList(state: Notes): HTMLElement {
  const list = h("ol")
  for (let i = 0; i < state.order.length || state.order.length < state.defs.size; i++) {
    if (i >= state.order.length) for (const id of state.defs.keys()) if (!state.order.includes(id)) state.order.push(id)
    const id = state.order[i]
    const target = `${state.prefix}-${i + 1}`
    const item = h("li", { id: target })
    blocks(state.defs.get(id) ?? [], item)
    if (state.calls.get(id)) {
      const back = h("a", { class: "fn-back", href: `#${target}-ref1`, "data-jump": `${target}-ref1`, "aria-label": "back to the text" }, "↩")
      const last = item.lastElementChild
      if (last?.tagName === "P") last.append(" ", back)
      else item.append(" ", back)
    }
    list.append(item)
  }
  return h("section", { class: "footnotes", "aria-label": "footnotes" }, list)
}

function link(url: string, children: Child[]): HTMLElement {
  if (/^(https?:|mailto:)/i.test(url)) return h("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, ...children)
  return h("span", { class: "ref", title: url }, ...children)
}

export function inline(text: string): Child[] {
  const out: Child[] = []
  let last = 0
  for (const m of text.matchAll(INLINE)) {
    const at = m.index ?? 0
    if (at > last) out.push(text.slice(last, at))
    last = at + m[0].length
    if (m[1] !== undefined) out.push(h("code", null, m[2].replace(/^ ([\s\S]*) $/, "$1")))
    else if (m[3] !== undefined) out.push(m[3])
    else if (m[6] !== undefined) out.push(link(m[6], inline(m[5])))
    else if (m[7] !== undefined) out.push(link(m[7], [m[7]]))
    else if (m[8] !== undefined) out.push(link(m[8], [m[8]]))
    else if (m[9] !== undefined || m[10] !== undefined) out.push(h("strong", null, ...inline(m[9] ?? m[10])))
    else if (m[11] !== undefined || m[12] !== undefined) out.push(h("em", null, ...inline(m[11] ?? m[12])))
    else if (m[13] !== undefined) out.push(h("s", null, ...inline(m[13])))
    else if (m[14] !== undefined) out.push(noteRef(m[14], m[0]))
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

const indentOf = (line: string) => line.length - line.trimStart().length

function startsBlock(lines: string[], i: number): boolean {
  const line = lines[i]
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    QUOTE.test(line) ||
    BULLET.test(line) ||
    (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]))
  )
}

function blocks(lines: string[], out: ParentNode) {
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    const fence = FENCE.exec(line)
    if (fence) {
      const close = new RegExp(`^\\s{0,3}${fence[2][0]}{${fence[2].length},}\\s*$`)
      const strip = new RegExp(`^\\s{0,${fence[1].length}}`)
      const body: string[] = []
      for (i++; i < lines.length && !close.test(lines[i]); i++) body.push(lines[i].replace(strip, ""))
      i++
      out.append(h("pre", { "data-lang": fence[3] || undefined }, h("code", null, body.join("\n"))))
      continue
    }
    const heading = HEADING.exec(line)
    if (heading) {
      const level = Math.min(5, heading[1].length + 2) as 3 | 4 | 5
      out.append(h(`h${level}`, null, ...inline(heading[2])))
      i++
      continue
    }
    if (RULE.test(line)) {
      out.append(h("hr"))
      i++
      continue
    }
    if (QUOTE.test(line)) {
      const body: string[] = []
      for (; i < lines.length && QUOTE.test(lines[i]); i++) body.push(lines[i].replace(QUOTE, ""))
      const quote = h("blockquote")
      blocks(body, quote)
      out.append(quote)
      continue
    }
    if (BULLET.test(line)) {
      i = list(lines, i, out)
      continue
    }
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      i = table(lines, i, out)
      continue
    }
    const para = [line.trim()]
    for (i++; i < lines.length && lines[i].trim() && !startsBlock(lines, i); i++) para.push(lines[i].trim())
    out.append(h("p", null, ...inline(para.join("\n"))))
  }
}

function list(lines: string[], start: number, out: ParentNode): number {
  const first = BULLET.exec(lines[start])!
  const base = first[1].length
  const ordered = /\d/.test(first[2])
  const el = h(ordered ? "ol" : "ul", ordered && Number.parseInt(first[2]) !== 1 ? { start: Number.parseInt(first[2]) } : null)
  let i = start
  while (i < lines.length) {
    const m = BULLET.exec(lines[i])
    if (!m || m[1].length < base || m[1].length > base + 1 || /\d/.test(m[2]) !== ordered) break
    const content = m[1].length + m[2].length + 1
    const body = [m[3]]
    i++
    while (i < lines.length) {
      const line = lines[i]
      if (!line.trim()) {
        let next = i
        while (next < lines.length && !lines[next].trim()) next++
        if (next >= lines.length || indentOf(lines[next]) < base + 2) break
        body.push("")
        i++
        continue
      }
      const indent = indentOf(line)
      if (indent >= base + 2) body.push(line.slice(Math.min(indent, content)))
      else if (BULLET.test(line) || startsBlock(lines, i) || !lines[i - 1]?.trim()) break
      else body.push(line.trim())
      i++
    }
    const item = h("li")
    const task = /^\[([ xX])\]\s+/.exec(body[0])
    if (task) {
      body[0] = body[0].slice(task[0].length)
      item.append(h("input", { type: "checkbox", disabled: true, checked: task[1] !== " ", "aria-label": task[1] === " " ? "not done" : "done" }))
    }
    const inner = document.createDocumentFragment()
    blocks(body, inner)
    const lead = inner.firstElementChild
    if (lead?.tagName === "P") lead.replaceWith(...lead.childNodes)
    item.append(inner)
    el.append(item)
    while (i < lines.length && !lines[i].trim() && i + 1 < lines.length && BULLET.test(lines[i + 1] ?? "") && indentOf(lines[i + 1]) <= base + 1 && indentOf(lines[i + 1]) >= base) i++
  }
  out.append(el)
  return i
}

function cells(line: string): string[] {
  let row = line.trim()
  if (row.startsWith("|")) row = row.slice(1)
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1)
  return row.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, "|"))
}

function table(lines: string[], start: number, out: ParentNode): number {
  const head = cells(lines[start])
  const align = cells(lines[start + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : undefined))
  const style = (n: number) => (align[n] ? { style: `text-align:${align[n]}` } : null)
  const body = h("tbody")
  let i = start + 2
  for (; i < lines.length && lines[i].trim() && lines[i].includes("|"); i++) {
    const row = cells(lines[i])
    body.append(h("tr", null, ...head.map((_, n) => h("td", style(n), ...inline(row[n] ?? "")))))
  }
  const thead = h("thead", null, h("tr", null, ...head.map((c, n) => h("th", { ...style(n), scope: "col" }, ...inline(c)))))
  out.append(h("div", { class: "table" }, h("table", null, thead, body)))
  return i
}
