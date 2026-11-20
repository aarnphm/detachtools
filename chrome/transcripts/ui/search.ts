import type { Found, Line, Mode, SessionHit } from "../server/search"
import type { Item, SessionMeta } from "../server/types"
import { type Child, h } from "./dom"
import { plain } from "./ansi"
import { age, stepName, summary } from "./tools"
import type { Transcript } from "./transcript"

export type Scope = "block" | "session" | "all"

export interface Selection {
  from: string
  to: string
  label: string
}

export interface SearchHost {
  get(path: string, signal?: AbortSignal): Promise<any>
  fetch(path: string, signal?: AbortSignal): Promise<Response>
  ref(): { source: string; id: string } | undefined
  cwd(): string | undefined
  tx: Transcript
  scroll: HTMLElement
  showThinking(): void
  selection(): Selection | undefined
  sessions(): Map<string, SessionMeta>
  go(source: string, id: string): void
  detail(text: string): void
}

interface Hit {
  id: string
  k: Item["k"]
  marks: string[]
  row: HTMLButtonElement
  session?: { source: string; id: string }
}

declare const Highlight: { new (...ranges: Range[]): unknown }

const TYPE_MS = 40
const TYPE_ALL_MS = 160
const LIVE_MS = 600
const WAIT_MS = 150
const SETTLE_MS = 1500

const took = (ms: number) => (ms < 1000 ? `${Math.max(1, Math.round(ms))} ms` : `${(ms / 1000).toFixed(1)} s`)
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const marksOf = (line: Line) => [...new Set(line.ranges.map(([from, to]) => line.text.slice(from, to)).filter(Boolean))]

function marked(line: Line): Child[] {
  const out: Child[] = []
  let at = 0
  for (const [from, to] of line.ranges) {
    if (from > at) out.push(line.text.slice(at, from))
    out.push(h("mark", null, line.text.slice(from, to)))
    at = to
  }
  if (at < line.text.length) out.push(line.text.slice(at))
  return out
}

function ranges(root: Element, needles: string[]): Range[] {
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ""
    for (const needle of needles) {
      for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + needle.length)
        out.push(range)
      }
    }
  }
  return out
}

export function setupSearch(host: SearchHost) {
  const input = h("input", { id: "seek-q", type: "search", placeholder: 'text, "a phrase", terms in any order', autocomplete: "off", autocapitalize: "off", spellcheck: "false" })
  const filter = h("input", { id: "seek-filter", type: "search", placeholder: "e.g. reply  bash  -read", autocomplete: "off", autocapitalize: "off", spellcheck: "false" })
  const toggle = (name: string, title: string) => h("button", { type: "button", "data-flag": name, "aria-pressed": "false", title }, name)
  const flags = h(
    "div",
    { class: "inst", role: "group", "aria-labelledby": "seek-flags" },
    toggle("case", "match capitals exactly"),
    toggle("word", "match whole words only"),
    toggle("regex", "read the search as a regular expression"),
    toggle("fuzzy", "match letters in order with gaps, best lines first"),
  )
  const pick = (name: Scope, text: string, title: string) => h("button", { type: "button", "data-scope": name, "aria-pressed": String(name === "session"), title }, text)
  const scopes = h(
    "div",
    { class: "inst", role: "group", "aria-labelledby": "seek-scope" },
    pick("block", "block", "the block selected with [ and ], or with option-click"),
    pick("session", "session", "the open session"),
    pick("all", "all sessions", "every session on this machine"),
  )
  const where = h("p", { class: "seek-where" })
  const sum = h("p", { class: "seek-sum", role: "status" })
  const results = h("div", { class: "seek-results" })
  const el = h(
    "div",
    { class: "seek" },
    h(
      "div",
      { class: "seek-form" },
      h("label", { for: "seek-q" }, "search"),
      input,
      h("label", { for: "seek-filter" }, "filter"),
      filter,
      h("span", { id: "seek-flags" }, "flags"),
      flags,
      h("span", { id: "seek-scope" }, "scope"),
      h("div", { class: "seek-scope" }, scopes, where),
    ),
    sum,
    results,
  )

  const marks = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  const on = { case: false, word: false, regex: false, fuzzy: false }
  let scope: Scope = "session"
  let hits: Hit[] = []
  let index = -1
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort: AbortController | undefined
  let pending: { id: string; k: Item["k"]; marks: string[] } | undefined
  let shown = ""
  let ticker: ReturnType<typeof setInterval> | undefined
  let watcher: MutationObserver | undefined

  const mode = (): Mode => (on.regex ? "regex" : on.fuzzy ? "fuzzy" : "terms")
  const clear = () => marks?.delete("find")

  function paintControls() {
    const picked = host.selection()
    if (scope === "block" && !picked) scope = "session"
    for (const button of flags.querySelectorAll<HTMLButtonElement>("button")) {
      const name = button.dataset.flag as keyof typeof on
      button.setAttribute("aria-pressed", String(on[name]))
      button.disabled = name === "word" && (on.regex || on.fuzzy)
    }
    for (const button of scopes.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.scope === scope))
      button.disabled = button.dataset.scope === "block" && !picked
    }
    where.textContent = scope === "block" ? (picked?.label ?? "") : scope === "all" ? `${host.sessions().size} sessions` : picked ? `${picked.label} is selected` : "select a block with [ and ] to search inside it"
    host.detail(scope === "block" ? `in ${picked?.label}` : scope === "all" ? "in every session" : "in this session")
  }

  function label(id: string): { where: string; what: string } {
    const info = host.tx.info(id)
    if (!info) return { where: "", what: "" }
    const name = info.item.k === "user" ? "prompt" : info.item.k === "text" ? "reply" : stepName(info.item)
    return { where: `${String(info.turn).padStart(2, "0")} · ${name}`, what: info.item.k === "tool" ? plain(summary(info.item, host.cwd())) : "" }
  }

  function row(line: Line, hit: Omit<Hit, "row">, lead: Child): HTMLButtonElement {
    const button = h("button", { type: "button", class: "seek-line" }, lead, h("span", { class: "tx" }, ...marked(line)))
    const at = hits.push({ ...hit, row: button }) - 1
    button.addEventListener("click", () => activate(at))
    return button
  }

  function render(found: Found) {
    results.replaceChildren()
    hits = []
    index = -1
    if (found.ranked) {
      for (const group of found.groups) {
        const tag = label(group.id)
        results.append(row(group.lines[0], { id: group.id, k: group.k, marks: marksOf(group.lines[0]) }, h("span", { class: "ln wide", title: tag.what }, tag.where)))
      }
    } else {
      for (const group of found.groups) {
        const tag = label(group.id)
        const section = h("section", { class: "seek-group" }, h("h3", { class: "seek-file" }, h("span", { class: "where" }, tag.where), h("span", { class: "what" }, tag.what), h("span", { class: "n" }, String(group.lines.length + group.more))))
        for (const line of group.lines) section.append(row(line, { id: group.id, k: group.k, marks: marksOf(line) }, h("span", { class: "ln" }, String(line.n))))
        if (group.more) section.append(h("p", { class: "seek-more" }, `${group.more} more ${group.more === 1 ? "line" : "lines"} in this item`))
        results.append(section)
      }
    }
    sum.dataset.state = found.total ? "some" : "none"
    return !found.total ? (filter.value.trim() ? "no matches with this filter" : "no matches") : `${plural(found.total, "match", "matches")} in ${plural(found.items, "item")}${found.truncated ? `, first ${hits.length} shown` : ""}`
  }

  function sessionGroup(session: SessionHit): HTMLElement {
    const meta = host.sessions().get(`${session.source}/${session.id}`)
    const project = meta?.cwd ? meta.cwd.slice(meta.cwd.lastIndexOf("/") + 1) : ""
    const section = h(
      "section",
      { class: "seek-group" },
      h("h3", { class: "seek-file" }, h("span", { class: "where" }, meta?.title ?? session.id.slice(0, 8)), h("span", { class: "what" }, [session.source, project, meta ? age(meta.updatedAt) : ""].filter(Boolean).join(" · ")), h("span", { class: "n" }, String(session.total))),
    )
    for (const line of session.lines ?? []) {
      section.append(row(line, { id: line.id, k: line.k, marks: marksOf(line), session: { source: session.source, id: session.id } }, h("span", { class: "ln" }, String(line.n))))
    }
    const rest = session.total - (session.lines?.length ?? 0)
    if (rest > 0) section.append(h("p", { class: "seek-more" }, `${rest} more in this session`))
    return section
  }

  function waiting(started: number, text: () => string) {
    clearInterval(ticker)
    ticker = setInterval(() => {
      const ms = performance.now() - started
      if (ms < WAIT_MS) return
      sum.dataset.state = "some"
      sum.textContent = `${text()} · ${took(ms)}`
    }, 100)
  }

  async function runAll(params: URLSearchParams, signal: AbortSignal, mine: number, started: number): Promise<string | undefined> {
    params.set("stream", "1")
    const res = await host.fetch(`search?${params}`, signal)
    if (!res.ok || !res.body) throw new Error(String(res.status))
    let total = 0
    let found = 0
    let scanned = 0
    let candidates = 0
    let first = true
    waiting(started, () => `${found ? `${plural(total, "match", "matches")} in ${plural(found, "session")}, ` : ""}searching ${scanned} of ${candidates} sessions`)
    const decoder = new TextDecoder()
    let rest = ""
    for (const reader = res.body.getReader(); ; ) {
      const chunk = await reader.read()
      if (mine !== seq) return undefined
      rest += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done })
      const lines = rest.split("\n")
      rest = lines.pop() ?? ""
      for (const text of lines) {
        if (!text) continue
        const event = JSON.parse(text)
        if (event.t === "start") candidates = event.candidates
        else if (event.t === "progress") scanned = event.scanned
        else if (event.t === "hit") {
          if (first) {
            results.replaceChildren()
            hits = []
            index = -1
            first = false
          }
          scanned = event.scanned
          found++
          total += event.hit.total
          results.append(sessionGroup(event.hit))
        } else if (event.t === "done") {
          if (event.error) return `not a valid regular expression: ${event.error}`
          if (first) {
            results.replaceChildren()
            hits = []
            index = -1
          }
          sum.dataset.state = total ? "some" : "none"
          return total ? `${plural(total, "match", "matches")} in ${plural(found, "session")}, ${event.scanned} searched` : `no matches in ${plural(event.scanned, "session")}`
        }
      }
      if (chunk.done) return undefined
    }
  }

  async function run(quiet = false) {
    const mine = ++seq
    abort?.abort()
    clearInterval(ticker)
    const q = input.value.trim()
    const ref = host.ref()
    paintControls()
    if (!q || (!ref && scope !== "all")) {
      results.replaceChildren()
      hits = []
      index = -1
      shown = ""
      sum.textContent = ""
      clear()
      return
    }
    const params = new URLSearchParams({ q, mode: mode(), filter: filter.value.trim() })
    if (on.case) params.set("case", "1")
    if (on.word && mode() === "terms") params.set("word", "1")
    const picked = host.selection()
    if (scope === "block" && picked) {
      params.set("from", picked.from)
      params.set("to", picked.to)
    }
    if (scope === "all") params.set("detail", "3")
    abort = new AbortController()
    const started = performance.now()
    const keep = index >= 0 ? hits[index]?.id : undefined
    const scroller = el.parentElement
    const top = scroller?.scrollTop ?? 0
    let text: string | undefined
    try {
      if (scope === "all") text = await runAll(params, abort.signal, mine, started)
      else {
        if (!quiet) waiting(started, () => "searching")
        const body = await host.fetch(`search/${ref!.source}/${encodeURIComponent(ref!.id)}?${params}`, abort.signal).then((res) => res.text())
        if (mine !== seq) return
        if (quiet && body === shown) return clearInterval(ticker)
        shown = body
        const found: Found & { error?: string } = JSON.parse(body)
        if (found.error) {
          results.replaceChildren()
          hits = []
          sum.dataset.state = "none"
          text = `not a valid regular expression: ${found.error}`
        } else text = render(found)
      }
    } catch {
      clearInterval(ticker)
      if (mine === seq && !abort.signal.aborted) {
        sum.dataset.state = "none"
        sum.textContent = "the server did not answer"
      }
      return
    }
    clearInterval(ticker)
    if (mine !== seq || text === undefined) return
    if (/^not a valid/.test(text)) sum.dataset.state = "none"
    sum.textContent = `${text} · ${took(performance.now() - started)}`
    index = keep ? hits.findIndex((hit) => hit.id === keep) : -1
    if (index >= 0) hits[index].row.setAttribute("aria-current", "true")
    if (quiet && scroller) scroller.scrollTop = top
    if (pending) {
      const want = pending
      pending = undefined
      const at = hits.findIndex((hit) => hit.id === want.id)
      if (at >= 0) activate(at)
      else show(want.id, want.k, want.marks)
    }
  }

  function show(id: string, k: Item["k"], needles: string[]) {
    if (k === "think") host.showThinking()
    const target = host.tx.reveal(id)
    if (!target) return
    watcher?.disconnect()
    clear()
    const place = (box: DOMRect) => {
      const view = host.scroll.getBoundingClientRect()
      if (box.top < view.top + 24 || box.bottom > view.bottom - 24) host.scroll.scrollTop += box.top - view.top - view.height / 3
    }
    const mark = () => {
      const found = ranges(target, needles).filter((r) => r.getClientRects().length)
      if (!found.length) return false
      if (marks) marks.set("find", new Highlight(...found))
      place(found[0].getBoundingClientRect())
      return true
    }
    place(target.getBoundingClientRect())
    target.classList.remove("fresh")
    void target.offsetWidth
    target.classList.add("fresh")
    if (mark()) return
    for (const more of target.querySelectorAll<HTMLButtonElement>('button.more[aria-expanded="false"]')) more.click()
    const observer = new MutationObserver(() => {
      if (mark()) observer.disconnect()
    })
    watcher = observer
    observer.observe(target, { childList: true, subtree: true, characterData: true })
    setTimeout(() => observer.disconnect(), SETTLE_MS)
  }

  function activate(at: number) {
    if (!hits.length) return
    index = (at + hits.length) % hits.length
    for (const hit of hits) hit.row.removeAttribute("aria-current")
    const hit = hits[index]
    hit.row.setAttribute("aria-current", "true")
    hit.row.scrollIntoView({ block: "nearest" })
    const ref = host.ref()
    if (hit.session && (!ref || hit.session.source !== ref.source || hit.session.id !== ref.id)) {
      pending = { id: hit.id, k: hit.k, marks: hit.marks }
      scope = "session"
      return host.go(hit.session.source, hit.session.id)
    }
    show(hit.id, hit.k, hit.marks)
  }

  const later = (ms: number, quiet = false) => {
    clearTimeout(timer)
    timer = setTimeout(() => void run(quiet), ms)
  }

  for (const field of [input, filter]) {
    field.addEventListener("input", () => {
      clear()
      later(scope === "all" ? TYPE_ALL_MS : TYPE_MS)
    })
  }
  for (const field of [input, filter]) {
    field.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault()
        activate(index + (event.shiftKey ? -1 : 1))
      } else if (event.key === "ArrowDown" && hits.length) {
        event.preventDefault()
        hits[Math.max(0, index)].row.focus()
      } else if (event.key === "Escape") {
        event.preventDefault()
        host.scroll.focus({ preventScroll: true })
      }
    })
  }
  flags.addEventListener("click", (event) => {
    const name = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.flag as keyof typeof on | undefined
    if (!name) return
    on[name] = !on[name]
    if (name === "regex" && on.regex) on.fuzzy = false
    if (name === "fuzzy" && on.fuzzy) on.regex = false
    clear()
    void run()
  })
  scopes.addEventListener("click", (event) => {
    const next = (event.target as HTMLElement).closest<HTMLButtonElement>("button")?.dataset.scope as Scope | undefined
    if (!next) return
    scope = next
    clear()
    void run()
  })
  results.addEventListener("keydown", (event) => {
    const at = hits.findIndex((hit) => hit.row === document.activeElement)
    if (at < 0 || event.metaKey || event.ctrlKey || event.altKey) return
    const by = event.key === "j" || event.key === "ArrowDown" ? 1 : event.key === "k" || event.key === "ArrowUp" ? -1 : 0
    if (by) {
      event.preventDefault()
      event.stopPropagation()
      hits[Math.min(hits.length - 1, Math.max(0, at + by))].row.focus()
    } else if (event.key === "/") {
      event.preventDefault()
      event.stopPropagation()
      input.focus()
      input.select()
    }
  })

  return {
    el,
    focus(q?: string, next?: Scope) {
      if (q !== undefined) input.value = q
      if (next) scope = next
      paintControls()
      input.focus()
      input.select()
      if (q !== undefined || next) void run()
    },
    step: (by: 1 | -1) => activate(index + by),
    hasHits: () => hits.length > 0,
    selectionChanged() {
      const before = scope
      paintControls()
      if (el.isConnected && (scope === "block" || before !== scope)) void run()
    },
    sessionChanged() {
      if (el.isConnected && input.value.trim()) void run()
    },
    refresh() {
      if (el.isConnected && scope !== "all" && input.value.trim()) later(LIVE_MS, true)
    },
    hidden() {
      seq++
      abort?.abort()
      clearInterval(ticker)
      watcher?.disconnect()
      clear()
    },
  }
}
