import { toDom } from "hast-util-to-dom"
import type { Patch } from "../server/types"
import { h } from "./dom"

const tokenColors = [
  { scope: ["comment", "punctuation.definition.comment"], settings: { foreground: "var(--diff-muted)" } },
  { scope: ["keyword", "storage"], settings: { foreground: "var(--diff-keyword)" } },
  { scope: ["string", "string.regexp"], settings: { foreground: "var(--diff-string)" } },
  { scope: ["constant"], settings: { foreground: "var(--diff-constant)" } },
  { scope: ["entity.name", "support.function", "variable.function"], settings: { foreground: "var(--diff-name)" } },
]

let pierre: Promise<typeof import("@pierre/diffs")> | undefined

export function patchView(patch: Patch, label: string): HTMLElement {
  const view = h("div", { class: "diff", role: "group", "aria-label": `diff for ${label}`, "aria-busy": "true" })
  void highlightPatch(patch, view)
    .catch(() => showText(patch, view))
    .finally(() => view.removeAttribute("aria-busy"))
  return view
}

async function highlightPatch(patch: Patch, view: HTMLElement) {
  const hunks = patch.hunks.filter(({ lines }) => lines.length)
  if (!hunks.length) return showText(patch, view)

  // The records carry start positions and may cap the body. Count the lines we actually received.
  const headers = hunks.map(({ o, n, lines }) => {
    const before = lines.filter((line) => /^[- ]/.test(line)).length
    const after = lines.filter((line) => /^[+ ]/.test(line)).length
    return [`@@ -${before ? Math.max(o, 1) : o},${before} +${after ? Math.max(n, 1) : n},${after} @@`, ...lines].join("\n")
  })
  pierre ??= import("@pierre/diffs").then((library) => {
    library.registerCustomTheme("transcripts-garden", () => ({
      name: "transcripts-garden",
      type: "light",
      colors: { "editor.foreground": "var(--dark)", "editor.background": "var(--surface)" },
      tokenColors,
    }))
    return library
  })
  const { DiffHunksRenderer, processFile } = await pierre
  const file = processFile(`--- file\n+++ file\n${headers.join("\n")}\n`, { throwOnError: true, disableLineMatching: true })
  if (!file?.hunks.length) return showText(patch, view)
  file.name = patch.file
  const renderer = new DiffHunksRenderer({
    diffStyle: "unified",
    hunkSeparators: "metadata",
    disableFileHeader: true,
    theme: "transcripts-garden",
    preferredHighlighter: "shiki-js",
  })
  const result = await renderer.asyncRender(file)
  const rows = document.createDocumentFragment()
  let lineDigits = 2
  for (const ast of result.unifiedContentAST ?? []) {
    const row = toDom(ast)
    if (!(row instanceof HTMLElement)) continue
    const number = row.dataset.line
    if (number === undefined) {
      if (row.hasAttribute("data-separator")) row.textContent = row.textContent?.trimEnd() ?? ""
    } else {
      lineDigits = Math.max(lineDigits, number.length)
      const sign = row.dataset.lineType === "change-addition" ? "+" : row.dataset.lineType === "change-deletion" ? "−" : ""
      const code = h("code", null, ...row.childNodes)
      row.append(h("span", { class: "diff-number" }, number), h("span", { class: "diff-sign" }, sign), code)
    }
    rows.append(row)
  }
  if (!rows.childNodes.length) return showText(patch, view)
  view.style.setProperty("--diff-number-width", `${lineDigits}ch`)
  view.replaceChildren(rows)
}

function showText(patch: Patch, view: HTMLElement) {
  const lines = patch.hunks.flatMap(({ o, n, lines }) => [`@@ -${o} +${n} @@`, ...lines])
  view.replaceChildren(h("pre", { class: "diff-plain" }, lines.join("\n")))
}
