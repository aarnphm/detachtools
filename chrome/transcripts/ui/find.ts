import type { ItemHit, Term } from "../server/search"
import type { Transcript } from "./transcript"

export interface FindHost {
  get(path: string): Promise<any>
  ref(): { source: string; id: string } | undefined
  tx: Transcript
  scroll: HTMLElement
  showThinking(): void
}

declare const Highlight: { new (...ranges: Range[]): unknown }

const TYPE_MS = 110
const RETRY_MS = [0, 80, 320, 900]

export function terms(q: string): Term[] {
  const out: Term[] = []
  for (const m of q.matchAll(/"([^"]+)"|(\S+)/g)) {
    const text = m[1] ?? m[2]
    const cased = text !== text.toLowerCase()
    out.push({ text: cased ? text : text.toLowerCase(), cased })
  }
  return out
}

function ranges(root: Element, wanted: Term[]): Range[] {
  const out: Range[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue ?? ""
    if (!text) continue
    const lower = text.toLowerCase()
    for (const term of wanted) {
      const hay = term.cased ? text : lower
      for (let at = hay.indexOf(term.text); at >= 0; at = hay.indexOf(term.text, at + term.text.length)) {
        const range = new Range()
        range.setStart(node, at)
        range.setEnd(node, at + term.text.length)
        out.push(range)
      }
    }
  }
  return out
}

export function setupFind(host: FindHost) {
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
  const bar = $("finder")
  const input = $<HTMLInputElement>("find-in")
  const count = $("find-count")
  const marks = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights
  let hits: ItemHit[] = []
  let index = -1
  let seq = 0
  let timer: ReturnType<typeof setTimeout> | undefined

  const paint = () => {
    const q = input.value.trim()
    count.dataset.state = q && !hits.length ? "none" : "some"
    count.textContent = !q ? "" : !hits.length ? "no matches" : index < 0 ? `${hits.length} ${hits.length === 1 ? "match" : "matches"}` : `${index + 1} / ${hits.length}`
  }

  const clear = () => marks?.delete("find")

  function nearest(): number {
    const top = host.scroll.getBoundingClientRect().top
    let above = -1
    for (let i = 0; i < hits.length; i++) {
      const el = host.tx.anchor(hits[i].id)
      if (!el) continue
      if (el.getBoundingClientRect().bottom >= top + 8) return i
      above = i
    }
    return above
  }

  function reveal(at: number) {
    if (!hits.length) return
    index = (at + hits.length) % hits.length
    paint()
    const hit = hits[index]
    if (hit.k === "think") host.showThinking()
    const el = host.tx.reveal(hit.id)
    if (!el) return
    const wanted = terms(input.value)
    const mine = ++seq
    let tries = 0
    const attempt = () => {
      if (mine !== seq) return
      const found = ranges(el, wanted).filter((r) => r.getClientRects().length)
      if (!found.length && tries < RETRY_MS.length - 1) {
        for (const more of el.querySelectorAll<HTMLButtonElement>('button.more[aria-expanded="false"]')) more.click()
        setTimeout(attempt, RETRY_MS[++tries])
        return
      }
      clear()
      if (found.length && marks) marks.set("find", new Highlight(...found))
      const box = (found[0] ?? el).getBoundingClientRect()
      const view = host.scroll.getBoundingClientRect()
      if (box.top < view.top + 24 || box.bottom > view.bottom - 24) host.scroll.scrollTop += box.top - view.top - view.height / 3
      if (!found.length) {
        el.classList.remove("fresh")
        void el.offsetWidth
        el.classList.add("fresh")
      }
    }
    attempt()
  }

  async function run(jump: boolean) {
    const ref = host.ref()
    const q = input.value.trim()
    const mine = ++seq
    if (!ref || !q) {
      hits = []
      index = -1
      clear()
      return paint()
    }
    const keep = index >= 0 ? hits[index]?.id : undefined
    let next: ItemHit[]
    try {
      next = (await host.get(`search/${ref.source}/${encodeURIComponent(ref.id)}?q=${encodeURIComponent(q)}`)).hits
    } catch {
      return
    }
    if (mine !== seq) return
    hits = next
    index = keep ? hits.findIndex((h) => h.id === keep) : -1
    if (jump && hits.length) return reveal(index >= 0 ? index : nearest())
    paint()
  }

  function open(q?: string) {
    bar.hidden = false
    if (q !== undefined) input.value = q
    input.focus()
    input.select()
    if (input.value.trim()) void run(true)
  }

  function close() {
    if (bar.hidden) return
    bar.hidden = true
    seq++
    hits = []
    index = -1
    clear()
    paint()
    host.scroll.focus({ preventScroll: true })
  }

  input.addEventListener("input", () => {
    clearTimeout(timer)
    index = -1
    timer = setTimeout(() => void run(true), TYPE_MS)
  })
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault()
      reveal(index + (event.shiftKey ? -1 : 1))
    } else if (event.key === "Escape") {
      event.preventDefault()
      close()
    }
  })
  $("find-next").addEventListener("click", () => reveal(index + 1))
  $("find-prev").addEventListener("click", () => reveal(index - 1))
  $("find-close").addEventListener("click", close)

  return {
    open,
    close,
    isOpen: () => !bar.hidden,
    step: (by: 1 | -1) => reveal(index + by),
    refresh: () => {
      if (!bar.hidden && input.value.trim()) void run(false)
    },
  }
}
