import type { Note } from "../server/notes"
import type { Snapshot } from "../server/types"
import { h } from "./dom"
import { note as renderNote } from "./render"
import { rel, stamp } from "./tools"
import { type Host, Transcript } from "./transcript"

export type View = { kind: "note"; target: string; anchor?: string; from?: string } | { kind: "agent"; agent: string; title: string } | { kind: "search" }

export interface PanelHost extends Host {
  base: string
  copy(button: HTMLButtonElement, text: string, rest: string): void
  search: { el: HTMLElement; hidden(): void }
}

export function setupPanel(host: PanelHost) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const side = $("side")
  const title = $("side-title")
  const sub = $("side-sub")
  const body = $("side-body")
  const back = $<HTMLButtonElement>("side-back")
  const copy = $<HTMLButtonElement>("side-copy")
  const stack: View[] = []
  let current: View | undefined
  let copyText = ""
  let stream: EventSource | undefined
  let seq = 0

  function head(name: string, detail: string, text: string) {
    title.textContent = name
    title.title = name
    sub.textContent = detail
    sub.title = detail
    copyText = text
    back.disabled = !stack.length
  }

  function message(heading: string, ...lines: string[]) {
    body.replaceChildren(h("div", { class: "side-state" }, h("p", { class: "side-lead" }, heading), ...lines.map((line) => h("p", { class: "quiet" }, line))))
  }

  async function showNote(view: Extract<View, { kind: "note" }>) {
    const mine = ++seq
    head(view.target, "", view.target)
    const waiting = setTimeout(() => mine === seq && message("reading the note"), 300)
    const query = new URLSearchParams({ target: view.target, cwd: host.cwd() ?? "", from: view.from ?? "" })
    let found: { note: Note | null; tried: string[] }
    try {
      found = await host.get(`note?${query}`)
    } catch {
      clearTimeout(waiting)
      if (mine === seq) message("the server did not answer", "the note could not be read. try again when the server is running.")
      return
    }
    clearTimeout(waiting)
    if (mine !== seq) return
    if (!found.note) {
      head(view.target, "not found", view.target)
      return message(`no note named “${view.target}”`, "looked for:", ...found.tried.map((path) => rel(path, host.cwd())))
    }
    const file = found.note
    const { body: content, props } = renderNote(file.text)
    head(file.title, `${rel(file.path, host.cwd())} · ${stamp(file.updatedAt)}`, file.path)
    const article = h("article", { class: "prose", "data-path": file.path })
    if (props.length) article.append(h("dl", { class: "props" }, ...props.flatMap(([key, value]) => [h("dt", null, key), h("dd", null, value)])))
    const lead = content.firstElementChild
    if (lead?.tagName === "H3" && lead.textContent?.trim() === file.title) lead.remove()
    article.append(content)
    body.replaceChildren(article)
    const wanted = view.anchor?.toLowerCase()
    const heading = wanted ? [...article.querySelectorAll<HTMLElement>("h3, h4, h5, h6")].find((el) => el.textContent?.trim().toLowerCase() === wanted) : undefined
    if (heading) heading.scrollIntoView({ block: "start" })
    else body.scrollTop = 0
  }

  function showAgent(view: Extract<View, { kind: "agent" }>) {
    const mine = ++seq
    const ref = host.ref()
    head(view.title || "subagent", `subagent ${view.agent}`, view.agent)
    if (!ref) return message("no session is open")
    const tx = new Transcript(host, view.agent)
    const es = new EventSource(`${host.base}/api/stream/${ref.source}/${encodeURIComponent(ref.id)}?agent=${encodeURIComponent(view.agent)}`)
    stream = es
    message("reading the subagent transcript")
    es.addEventListener("snapshot", (event) => {
      if (mine !== seq) return
      const snap: Snapshot = JSON.parse((event as MessageEvent).data)
      tx.reset(snap.items)
      body.replaceChildren(tx.el)
      head(view.title || "subagent", [`subagent ${view.agent}`, snap.meta.model, `${tx.steps} tool calls`].filter(Boolean).join(" · "), view.agent)
    })
    es.addEventListener("upsert", (event) => {
      if (mine !== seq) return
      const near = body.scrollHeight - body.scrollTop - body.clientHeight < 96
      tx.upsert(JSON.parse((event as MessageEvent).data).items)
      if (near) body.scrollTop = body.scrollHeight
    })
    es.addEventListener("error", () => {
      if (mine !== seq || es.readyState !== EventSource.CLOSED) return
      message("the subagent transcript is not on disk", "the step ran, but its transcript file was not found beside the session.")
    })
  }

  function show(view: View) {
    stream?.close()
    stream = undefined
    if (current?.kind === "search" && view.kind !== "search") host.search.hidden()
    current = view
    side.hidden = false
    copy.disabled = view.kind === "search"
    if (view.kind === "note") void showNote(view)
    else if (view.kind === "agent") showAgent(view)
    else {
      seq++
      head("search", "", "")
      body.replaceChildren(host.search.el)
    }
  }

  function open(view: View) {
    if (view.kind === "search" && current?.kind === "search" && !side.hidden) return
    if (current && !side.hidden) stack.push(current)
    show(view)
    if (view.kind !== "search") body.focus({ preventScroll: true })
  }

  function close() {
    if (side.hidden) return
    if (current?.kind === "search") host.search.hidden()
    seq++
    stream?.close()
    stream = undefined
    stack.length = 0
    current = undefined
    side.hidden = true
    body.replaceChildren()
  }

  back.addEventListener("click", () => {
    const previous = stack.pop()
    if (previous) show(previous)
  })
  copy.addEventListener("click", () => host.copy(copy, copyText, "copy"))
  $("side-close").addEventListener("click", close)

  return {
    open,
    close,
    isOpen: () => !side.hidden,
    detail(text: string) {
      if (current?.kind === "search") sub.textContent = text
    },
    sessionChanged() {
      stack.length = 0
      back.disabled = true
      if (current?.kind !== "search") close()
    },
  }
}
