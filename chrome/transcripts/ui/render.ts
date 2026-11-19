import { toDom } from "hast-util-to-dom"
import { findAndReplace } from "mdast-util-find-and-replace"
import rehypeHighlight from "rehype-highlight"
import rehypeKatex from "rehype-katex"
import rehypeSlug from "rehype-slug"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import remarkParse from "remark-parse"
import remarkRehype from "remark-rehype"
import { unified } from "unified"
import { SKIP, visit } from "unist-util-visit"
import { h } from "./dom"

const CODE = /(?:^|\n) {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\1[`~]*[ \t]*(?=\n|$)|$)|(`+)[\s\S]*?\2/g
const DOLLARS = /\$\$[\s\S]+?\$\$|(?<![\\$\w])\$(?![\s$])(?:[^$\\\n]|\\.)+?(?<![\s\\])\$(?![\d$])|(?<!\\)\$/g
const WIKILINK = /(!?)\[\[([^[\]|#\\]*)(#[^[\]|\\]*)?(?:\\?\|([^[\]]*))?\]\]/g
const HIGHLIGHT = /==(?=\S)([^=\n]+?)(?<=\S)==/g
const COMMENT = /%%[\s\S]*?%%/g
const CALLOUT = /^\[!(\w+)\][+-]?[ \t]*([^\n]*)\n?/
const FRONTMATTER = /^---\n([\s\S]*?)\n---[ \t]*(?:\n|$)/

function math(part: string): string {
  return part
    .replace(/\\\[([\s\S]+?)\\\]/g, (_all, body: string) => `\n$$\n${body.trim()}\n$$\n`)
    .replace(/\\\((.+?)\\\)/g, (_all, body: string) => `$${body.trim()}$`)
    .replace(/^([ \t]*)\$\$(?!\s*$)(.+?)\$\$[ \t]*$/gm, (_all, indent: string, body: string) => `${indent}$$\n${indent}${body.trim()}\n${indent}$$`)
    .replace(DOLLARS, (hit) => (hit === "$" ? "\\$" : hit))
}

function prepare(src: string): string {
  let out = ""
  let last = 0
  for (const code of src.matchAll(CODE)) {
    const at = code.index ?? 0
    out += math(src.slice(last, at)) + code[0]
    last = at + code[0].length
  }
  return out + math(src.slice(last))
}

function obsidian() {
  return (tree: any) => {
    visit(tree, "html", (node: any, index, parent: any) => {
      if (!parent || index === undefined) return
      const text = { type: "text", value: node.value }
      parent.children[index] = parent.type === "root" || parent.type === "blockquote" || parent.type === "listItem" ? { type: "paragraph", children: [text] } : text
    })
    findAndReplace(
      tree,
      [
        [COMMENT, ""],
        [
          WIKILINK,
          (_all: string, embed: string, target: string, anchor: string | undefined, alias: string | undefined) => {
            const name = (target ?? "").trim()
            const label = alias?.trim() || `${name}${anchor ?? ""}`
            if (!label) return false
            return {
              type: "link",
              url: "#",
              data: { hProperties: { className: ["wikilink"], "data-note": name, "data-anchor": anchor?.slice(1).trim() || undefined, "data-embed": embed ? "" : undefined } },
              children: [{ type: "text", value: label }],
            }
          },
        ],
        [HIGHLIGHT, (_all: string, body: string) => ({ type: "emphasis", data: { hName: "mark" }, children: [{ type: "text", value: body }] })],
      ] as any,
      { ignore: ["link", "linkReference"] },
    )
    visit(tree, "blockquote", (node: any) => {
      const lead = node.children[0]
      const first = lead?.type === "paragraph" ? lead.children[0] : undefined
      const mark = first?.type === "text" ? CALLOUT.exec(first.value) : null
      if (!mark) return
      const kind = mark[1].toLowerCase()
      first.value = first.value.slice(mark[0].length)
      if (!first.value) lead.children.shift()
      if (!lead.children.length) node.children.shift()
      node.children.unshift({ type: "paragraph", data: { hProperties: { className: ["callout-title"] } }, children: [{ type: "text", value: mark[2].trim() || kind }] })
      node.data = { hName: "div", hProperties: { className: ["callout"], "data-callout": kind } }
      return SKIP
    })
  }
}

function shape() {
  return (tree: any) => {
    visit(tree, "element", (node: any, index, parent: any) => {
      const rank = /^h([1-6])$/.exec(node.tagName)
      if (rank) node.tagName = `h${Math.min(6, Number(rank[1]) + 2)}`
      else if (node.tagName === "img" && parent && index !== undefined) {
        const src = String(node.properties?.src ?? "")
        parent.children[index] = { type: "element", tagName: "span", properties: { className: ["ref"], title: src }, children: [{ type: "text", value: String(node.properties?.alt || src) }] }
      }
    })
  }
}

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkMath)
  .use(obsidian)
  .use(remarkRehype, { clobberPrefix: "", footnoteLabelTagName: "h6", footnoteLabelProperties: { className: ["sr"] } })
  .use(rehypeSlug)
  .use(rehypeKatex, { strict: "ignore" })
  .use(rehypeHighlight)
  .use(shape)
  .freeze()

let serial = 0

function finish(root: DocumentFragment) {
  const prefix = `m${++serial}-`
  for (const el of root.querySelectorAll<HTMLElement>("[id]")) el.id = prefix + el.id
  for (const el of root.querySelectorAll<HTMLElement>("[aria-describedby]")) el.setAttribute("aria-describedby", prefix + el.getAttribute("aria-describedby"))
  for (const link of root.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = link.getAttribute("href") ?? ""
    const note = link.dataset.note
    if (note !== undefined || /\.(?:md|markdown)(?:#.*)?$/i.test(href) && !/^[a-z][a-z0-9+.-]*:/i.test(href)) {
      const [path, hash] = note !== undefined ? [note, link.dataset.anchor] : href.split("#")
      const button = h("button", { type: "button", class: "notelink", "data-note": decodeURI(path), "data-anchor": hash ? decodeURIComponent(hash) : undefined })
      button.append(...link.childNodes)
      link.replaceWith(button)
    } else if (href.startsWith("#")) link.dataset.jump = prefix + decodeURIComponent(href.slice(1))
    else if (/^(?:https?:|mailto:)/i.test(href)) {
      link.target = "_blank"
      link.rel = "noopener noreferrer"
    } else {
      const span = h("span", { class: "ref", title: href })
      span.append(...link.childNodes)
      link.replaceWith(span)
    }
  }
  for (const table of root.querySelectorAll("table")) {
    const wrap = h("div", { class: "table" })
    table.replaceWith(wrap)
    wrap.append(table)
  }
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const lang = /(?:^|\s)language-(\S+)/.exec(code.className)?.[1]
    if (lang) code.parentElement!.dataset.lang = lang
  }
}

export function markdown(src: string): DocumentFragment {
  const text = prepare(src.replace(/\r\n?/g, "\n"))
  let root: DocumentFragment
  try {
    root = toDom(processor.runSync(processor.parse(text)) as any, { fragment: true }) as DocumentFragment
  } catch {
    root = document.createDocumentFragment()
    root.append(h("p", null, src))
  }
  finish(root)
  return root
}

export function note(src: string): { body: DocumentFragment; props: [string, string][] } {
  const text = src.replace(/\r\n?/g, "\n")
  const front = FRONTMATTER.exec(text)
  const props: [string, string][] = []
  for (const line of front?.[1].split("\n") ?? []) {
    const pair = /^([\w-]+):\s*(.*)$/.exec(line)
    if (pair) props.push([pair[1], pair[2]])
    else if (props.length && line.trim()) {
      const last = props[props.length - 1]
      last[1] = last[1] ? `${last[1]} · ${line.trim()}` : line.trim()
    }
  }
  return { body: markdown(front ? text.slice(front[0].length) : text), props }
}
