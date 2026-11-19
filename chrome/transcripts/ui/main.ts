import type { SessionHit } from "../server/search"
import type { Item, SessionMeta, SessionsDelta, Snapshot, Source } from "../server/types"
import { h } from "./dom"
import { setupFind } from "./find"
import { setupToc } from "./toc"
import { age, dayGroup, rel, stamp } from "./tools"
import { Transcript } from "./transcript"

declare const SERVER_COMMAND: string
declare const INSTALL_COMMAND: string
declare const HOST_NAME: string
declare const API_PORT: number
declare const chrome: { runtime?: { sendNativeMessage?: (host: string, message: unknown) => Promise<{ ok: boolean; error?: string }> } } | undefined

const BASE = location.protocol === "chrome-extension:" ? `http://127.0.0.1:${API_PORT}` : ""
const LIVE_MS = 30_000
const THEMES = ["auto", "light", "dark"] as const
type Theme = (typeof THEMES)[number]

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const find = $<HTMLInputElement>("find")
const list = $("sessions")
const conn = $("conn")
const bar = $("bar")
const title = $("title")
const readout = $("readout")
const scroll = $("scroll")
const mount = $("mount")
const state = $("state")
const latest = $<HTMLButtonElement>("latest")
const followButton = $<HTMLButtonElement>("follow")
const expandButton = $<HTMLButtonElement>("expand")
const thinkButton = $<HTMLButtonElement>("think")
const copyButton = $<HTMLButtonElement>("copy")
const themeButton = $<HTMLButtonElement>("theme")
const keymap = $("keys")

const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  set(key: string, value: string) {
    try {
      localStorage.setItem(key, value)
    } catch {}
  },
}

const sessions = new Map<string, SessionMeta>()
const rows = new Map<string, HTMLAnchorElement>()
let source: Source | "all" = "all"
let online = false
let current: { source: Source; id: string } | undefined
let meta: SessionMeta | undefined
let stream: EventSource | undefined
let streamUp = false
let unseen = 0
let wasLive = false
let follow = store.get("follow") !== "off"
let think = store.get("think") !== "off"
let expanded = false
let waking = false
let wokeAt = 0
let hostMissing = false
let listStream: EventSource | undefined
let pendingFind: string | undefined
let contentQuery = ""
let contentHits = new Map<string, SessionHit>()
let contentBusy = false
let contentTimer: ReturnType<typeof setTimeout> | undefined
let contentAbort: AbortController | undefined
let theme: Theme = (THEMES as readonly string[]).includes(store.get("theme") ?? "") ? (store.get("theme") as Theme) : "auto"

const keyOf = (m: { source: string; id: string }) => `${m.source}/${m.id}`
const hrefOf = (m: { source: string; id: string }) => `#/${m.source}/${encodeURIComponent(m.id)}`
const isLive = () => !!meta && streamUp && Date.now() - meta.updatedAt < LIVE_MS

async function get(path: string, signal?: AbortSignal): Promise<any> {
  const res = await fetch(`${BASE}/api/${path}`, { signal })
  if (!res.ok) throw new Error(String(res.status))
  return res.json()
}

const tx = new Transcript({ get, ref: () => current, cwd: () => meta?.cwd, live: isLive })
const toc = setupToc({ stage: $("stage"), scroll, content: () => tx.el })
const finder = setupFind({
  get,
  ref: () => current,
  tx,
  scroll,
  showThinking: () => {
    if (!think) toggleThink()
  },
})

function show(heading: string, ...body: (Node | string)[]) {
  mount.replaceChildren()
  tx.reset([])
  toc.refresh()
  bar.hidden = true
  state.replaceChildren(h("h2", null, heading), ...body)
}

function command(text: string): Node[] {
  const copy = h("button", { type: "button", class: "lone w-copy" }, "copy")
  copy.addEventListener("click", () => flash(copy, text, "copy"))
  return [h("pre", { class: "pre" }, text), copy]
}

const canWake = () => typeof chrome !== "undefined" && !!chrome.runtime?.sendNativeMessage

function wake(onFail?: (reason: string) => void) {
  if (!canWake() || hostMissing || waking || Date.now() - wokeAt < 10_000) return
  waking = true
  wokeAt = Date.now()
  chrome!.runtime!.sendNativeMessage!(HOST_NAME, { cmd: "start" })
    .then((res) => {
      waking = false
      if (res.ok) connect()
      else onFail?.(res.error ?? "the native host gave no reason.")
    })
    .catch((error: Error) => {
      waking = false
      hostMissing = /not found|forbidden/i.test(error.message)
      onFail?.(error.message)
    })
}

function showOffline() {
  if (!canWake()) {
    return show("the local server is not running", h("p", null, "transcripts are read from this machine by a small server. start it and this page connects by itself."), ...command(SERVER_COMMAND))
  }
  if (hostMissing) {
    return show(
      "the extension cannot start the server yet",
      h("p", null, "chrome starts the server through a native host, and the host is not registered for this browser. run this once, then reload the page."),
      ...command(INSTALL_COMMAND),
    )
  }
  if (waking || Date.now() - wokeAt < 10_000) return
  show("starting the local server", h("p", null, "the page connects as soon as the server answers."))
  wake((reason) => {
    if (hostMissing) showOffline()
    else show("the server did not start", h("p", null, reason), ...command(SERVER_COMMAND))
  })
}

function showIdle() {
  const open = h("button", { type: "button", class: "lone back" }, "sessions")
  open.addEventListener("click", () => setRail(true))
  show("no session open", h("p", null, "pick a session from the list, or paste a session id or a transcript path into the filter and press enter."), open)
}

async function flash(button: HTMLButtonElement, text: string, rest: string) {
  try {
    await navigator.clipboard.writeText(text)
    button.textContent = "copied"
  } catch {
    button.textContent = "copy failed"
  }
  setTimeout(() => {
    button.textContent = rest
  }, 1400)
}

function setRail(open: boolean) {
  document.body.dataset.rail = open ? "open" : "closed"
  if (open) find.focus({ preventScroll: true })
}

const contentHit = (m: SessionMeta) => (contentQuery === find.value.trim() ? contentHits.get(keyOf(m)) : undefined)

function visible(): SessionMeta[] {
  const q = find.value.trim().toLowerCase()
  return [...sessions.values()]
    .filter((m) => (source === "all" || m.source === source) && (!q || `${m.title} ${m.id} ${m.cwd ?? ""} ${m.source}`.toLowerCase().includes(q) || contentHit(m)))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

function searchContent() {
  clearTimeout(contentTimer)
  contentAbort?.abort()
  const q = find.value.trim()
  if (q.length < 3 || /^[~/]/.test(q)) {
    contentBusy = false
    contentQuery = ""
    contentHits = new Map()
    return
  }
  contentBusy = true
  contentTimer = setTimeout(async () => {
    const abort = new AbortController()
    contentAbort = abort
    try {
      const res: { sessions: SessionHit[] } = await get(`search?q=${encodeURIComponent(q)}`, abort.signal)
      if (abort.signal.aborted) return
      contentHits = new Map(res.sessions.map((hit) => [keyOf(hit), hit]))
      contentQuery = q
    } catch {
      if (abort.signal.aborted) return
    }
    contentBusy = false
    renderRail()
  }, 200)
}

function renderRail() {
  const now = Date.now()
  const shown = visible()
  const focused = document.activeElement instanceof HTMLAnchorElement ? document.activeElement.dataset.key : undefined
  const nodes: Node[] = []
  let group = ""
  for (const m of shown) {
    const name = dayGroup(m.updatedAt, now)
    if (name !== group) {
      group = name
      nodes.push(h("h3", { class: "day" }, name))
    }
    const key = keyOf(m)
    let row = rows.get(key)
    if (!row) {
      row = h("a", { class: "sess", "data-key": key, href: hrefOf(m) }, h("span", { class: "sess-title" }), h("span", { class: "sess-meta" }))
      rows.set(key, row)
    }
    const live = now - m.updatedAt < LIVE_MS
    const project = m.cwd ? m.cwd.slice(m.cwd.lastIndexOf("/") + 1) : ""
    const hit = contentHit(m)
    row.href = hit ? `${hrefOf(m)}?find=${encodeURIComponent(contentQuery)}` : hrefOf(m)
    row.children[0].textContent = m.title
    row.title = m.title
    row.children[1].replaceChildren(
      h("span", null, m.source),
      h("span", { class: "proj" }, project),
      hit
        ? h("span", null, `${hit.hits} ${hit.hits === 1 ? "match" : "matches"}`)
        : live
          ? h("span", { class: "live" }, "live")
          : h("time", { datetime: new Date(m.updatedAt).toISOString(), title: stamp(m.updatedAt) }, age(m.updatedAt, now)),
    )
    if (hit) {
      const line = row.children[2] ?? row.appendChild(h("span", { class: "sess-hit" }))
      line.textContent = hit.snippet
    } else row.children[2]?.remove()
    if (current && key === keyOf(current)) row.setAttribute("aria-current", "page")
    else row.removeAttribute("aria-current")
    nodes.push(row)
  }
  if (!shown.length && online) {
    const q = find.value.trim()
    const text = !q ? "no sessions on this machine yet." : contentBusy ? "searching the transcripts" : `no title and no transcript matches “${q}”. press enter to open it as a session id or a transcript path.`
    nodes.push(h("p", { class: "empty" }, text))
  }
  const same = nodes.length === list.childNodes.length && nodes.every((n, i) => n === list.childNodes[i])
  if (!same) {
    list.replaceChildren(...nodes)
    if (focused) rows.get(focused)?.focus({ preventScroll: true })
  }
  const searched = contentQuery !== "" && contentQuery === find.value.trim()
  conn.textContent = !online ? "offline" : contentBusy ? "searching" : searched ? `${contentHits.size} with matches` : `${sessions.size} sessions`
  conn.dataset.state = online ? "online" : "offline"
}

function renderBar() {
  if (!meta || !current) return
  bar.hidden = false
  state.replaceChildren()
  title.textContent = meta.title
  title.title = meta.title
  document.title = `${meta.title} · transcripts`
  const cell = (name: string, value: string | undefined, extra: Record<string, string> = {}) =>
    value ? h("div", extra, h("dt", { class: "sr" }, name), h("dd", { title: value }, value)) : ""
  const live = isLive()
  readout.replaceChildren(
    cell("source", meta.source),
    cell("directory", meta.cwd ? rel(meta.cwd) : undefined),
    cell("branch", meta.branch && meta.branch !== "HEAD" ? meta.branch : undefined),
    cell("model", meta.model),
    cell("turns", `${tx.turns} ${tx.turns === 1 ? "turn" : "turns"}`),
    cell("tool calls", `${tx.steps} ${tx.steps === 1 ? "tool call" : "tool calls"}`),
    h(
      "div",
      { class: "status", "data-state": streamUp ? (live ? "live" : "idle") : "offline" },
      h("dt", { class: "sr" }, "status"),
      h("dd", { class: live ? "live" : "", title: stamp(meta.updatedAt) }, streamUp ? (live ? "live" : `idle ${age(meta.updatedAt)}`) : "disconnected"),
    ),
  )
  if (wasLive && !live) tx.refresh()
  wasLive = live
}

const atBottom = () => scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 96

function toBottom() {
  scroll.scrollTop = scroll.scrollHeight
  unseen = 0
  latest.hidden = true
}

function arrived(items: Item[]) {
  const stick = follow && atBottom()
  tx.upsert(items)
  toc.refresh()
  if (stick) return toBottom()
  if (atBottom()) return
  unseen += items.length
  latest.textContent = `${unseen} new`
  latest.hidden = false
}

function close() {
  finder.close()
  stream?.close()
  stream = undefined
  streamUp = false
  meta = undefined
  unseen = 0
  latest.hidden = true
}

function open(next: { source: Source; id: string }, query?: string) {
  if (current && keyOf(current) === keyOf(next) && stream) {
    if (query && meta) finder.open(query)
    return
  }
  close()
  current = next
  pendingFind = query
  tx.openRuns.clear()
  tx.openSteps.clear()
  expanded = false
  paintControls()
  setRail(false)
  renderRail()
  mount.replaceChildren()
  state.replaceChildren()
  const waiting = setTimeout(() => {
    if (!meta) state.replaceChildren(h("p", null, "reading the transcript"))
  }, 300)
  const es = new EventSource(`${BASE}/api/stream/${next.source}/${encodeURIComponent(next.id)}`)
  stream = es
  es.addEventListener("open", () => {
    streamUp = true
  })
  es.addEventListener("snapshot", (event) => {
    clearTimeout(waiting)
    const snap: Snapshot = JSON.parse((event as MessageEvent).data)
    const first = !meta
    const top = scroll.scrollTop
    meta = snap.meta
    streamUp = true
    tx.reset(snap.items)
    if (!mount.contains(tx.el)) mount.replaceChildren(tx.el)
    toc.refresh()
    renderBar()
    if (first) toBottom()
    else scroll.scrollTop = top
    if (first && pendingFind) finder.open(pendingFind)
    else finder.refresh()
    pendingFind = undefined
  })
  es.addEventListener("upsert", (event) => {
    arrived(JSON.parse((event as MessageEvent).data).items)
    renderBar()
    finder.refresh()
  })
  es.addEventListener("meta", (event) => {
    meta = JSON.parse((event as MessageEvent).data)
    renderBar()
  })
  es.addEventListener("error", () => {
    clearTimeout(waiting)
    streamUp = false
    if (stream !== es) return
    if (es.readyState === EventSource.CLOSED && online) {
      close()
      show("transcript not found", h("p", null, `no ${next.source} session has the id ${next.id}. it may have been deleted, or it lives on another machine.`))
    } else if (meta) renderBar()
    else if (!online) showOffline()
  })
}

async function lookup(q: string) {
  try {
    const { hit }: { hit: { source: Source; id: string } | null } = await get(`resolve?q=${encodeURIComponent(q)}`)
    if (!hit) throw new Error("no match")
    find.value = ""
    searchContent()
    location.hash = hrefOf(hit)
  } catch {
    close()
    current = undefined
    renderRail()
    if (online) show("nothing to open", h("p", null, `“${q}” is not a session id on this machine and not a path to a transcript file. ids match from their first four characters; paths end in .jsonl or .db.`))
    else showOffline()
  }
}

function route() {
  const hash = location.hash
  const session = /^#\/(claude|argon|codex)\/([^?]+)(?:\?find=(.*))?$/.exec(hash)
  if (session) return open({ source: session[1] as Source, id: decodeURIComponent(session[2]) }, session[3] ? decodeURIComponent(session[3]) : undefined)
  if (hash.startsWith("#q=")) return void lookup(decodeURIComponent(hash.slice(3)))
  close()
  current = undefined
  document.title = "transcripts"
  renderRail()
  if (online) showIdle()
  else showOffline()
  setRail(true)
}

function connect() {
  listStream?.close()
  const es = new EventSource(`${BASE}/api/sessions/stream`)
  listStream = es
  es.addEventListener("sessions", (event) => {
    const delta: SessionsDelta & { full?: boolean } = JSON.parse((event as MessageEvent).data)
    if (delta.full) sessions.clear()
    for (const m of delta.upsert) sessions.set(keyOf(m), m)
    for (const key of delta.remove) {
      sessions.delete(key)
      rows.delete(key)
    }
    const first = !online
    online = true
    renderRail()
    if (first) route()
  })
  es.addEventListener("error", () => {
    online = false
    renderRail()
    if (!meta) showOffline()
    else wake()
  })
}

function paintControls() {
  followButton.setAttribute("aria-pressed", String(follow))
  expandButton.setAttribute("aria-pressed", String(expanded))
  thinkButton.setAttribute("aria-pressed", String(think))
  themeButton.textContent = `theme ${theme}`
  document.body.dataset.think = think ? "on" : "off"
  if (theme === "auto") delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}

function toggleFollow() {
  follow = !follow
  store.set("follow", follow ? "on" : "off")
  paintControls()
  if (follow) toBottom()
}

function toggleExpand() {
  expanded = !expanded
  tx.expand(expanded)
  paintControls()
}

function toggleThink() {
  think = !think
  store.set("think", think ? "on" : "off")
  paintControls()
}

function step(direction: 1 | -1) {
  const turns = [...tx.el.querySelectorAll<HTMLElement>(":scope > .turn")]
  const top = scroll.getBoundingClientRect().top
  const offsets = turns.map((t) => t.getBoundingClientRect().top - top)
  const target = direction > 0 ? turns[offsets.findIndex((o) => o > 12)] : turns[offsets.findLastIndex((o) => o < -12)]
  if (target) target.scrollIntoView({ block: "start" })
  else if (direction > 0) toBottom()
}

followButton.addEventListener("click", toggleFollow)
expandButton.addEventListener("click", toggleExpand)
thinkButton.addEventListener("click", toggleThink)
copyButton.addEventListener("click", () => current && flash(copyButton, current.id, "copy id"))
themeButton.addEventListener("click", () => {
  theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]
  store.set("theme", theme)
  paintControls()
})
latest.addEventListener("click", toBottom)
$("back").addEventListener("click", () => setRail(true))
scroll.addEventListener("scroll", () => {
  if (atBottom()) {
    unseen = 0
    latest.hidden = true
  }
}, { passive: true })

find.addEventListener("input", () => {
  searchContent()
  renderRail()
})
find.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    find.value = ""
    searchContent()
    renderRail()
    return
  }
  if (event.key !== "Enter") return
  const q = find.value.trim()
  if (!q) return
  const hits = visible()
  if (hits.length && !/^[~/]/.test(q)) location.hash = rows.get(keyOf(hits[0]))?.getAttribute("href") ?? hrefOf(hits[0])
  else void lookup(q)
})

$("sources").addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-source]")
  if (!button) return
  source = button.dataset.source as Source | "all"
  for (const b of $("sources").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b === button))
  renderRail()
})

document.addEventListener("keydown", (event) => {
  const target = event.target as HTMLElement
  if ((event.metaKey || event.ctrlKey) && !event.altKey && current && meta) {
    const key = event.key.toLowerCase()
    if (key === "f" && !event.shiftKey) {
      event.preventDefault()
      return finder.open()
    }
    if (key === "g" && finder.isOpen()) {
      event.preventDefault()
      return finder.step(event.shiftKey ? -1 : 1)
    }
  }
  if (event.metaKey || event.ctrlKey || event.altKey || target.closest("input, textarea, select, [contenteditable]")) return
  if (event.key === "?") {
    event.preventDefault()
    return keymap.togglePopover()
  }
  if (keymap.matches(":popover-open")) return
  const actions: Record<string, () => void> = {
    "/": () => {
      setRail(true)
      find.focus()
      find.select()
    },
    j: () => step(1),
    k: () => step(-1),
    g: () => scroll.scrollTo({ top: 0 }),
    G: toBottom,
    e: toggleExpand,
    f: toggleFollow,
    t: toggleThink,
  }
  const action = actions[event.key]
  if (!action || (!current && event.key !== "/")) return
  event.preventDefault()
  action()
})

document.addEventListener("click", (event) => {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[data-jump]")
  if (!link) return
  event.preventDefault()
  const target = document.getElementById(link.dataset.jump ?? "")
  if (!target) return
  target.scrollIntoView({ block: "center" })
  if (!target.matches("a")) target.tabIndex = -1
  target.focus({ preventScroll: true })
  target.classList.remove("fresh")
  void target.offsetWidth
  target.classList.add("fresh")
})

window.addEventListener("hashchange", route)
setInterval(() => {
  renderRail()
  if (meta) renderBar()
}, 10_000)

paintControls()
connect()
setTimeout(() => {
  if (!online) {
    renderRail()
    showOffline()
  }
}, 1200)
