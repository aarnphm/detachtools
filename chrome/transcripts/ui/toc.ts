import { h } from "./dom"

const SIGMA = 42
const RADIUS = SIGMA * 3
const LERP = 0.32
const EPSILON = 0.08
const BUFFER = 48
const SCROLL_END_MS = 140

interface Metric {
  button: HTMLButtonElement
  fill: HTMLElement
  center: number
  touched: boolean
}

export interface TocHost {
  stage: HTMLElement
  scroll: HTMLElement
  content(): HTMLElement
}

export function setupToc(host: TocHost) {
  const nav = h("nav", { "aria-label": "turns and headings" })
  const label = h("div", { class: "toc-label", "aria-hidden": "true" })
  const toc = h("div", { class: "toc", hidden: true }, nav, label)
  host.stage.append(toc)

  const buttons = new Map<Element, HTMLButtonElement>()
  const targets = new WeakMap<HTMLButtonElement, Element>()
  const still = matchMedia("(prefers-reduced-motion: reduce)")
  let metrics: Metric[] = []
  let touched: Metric[] = []
  let maxScale = 1
  let hovering = false
  let frame = 0
  let queued = 0
  let goal = 0
  let at = 0
  let navTop = 0
  let active: HTMLButtonElement | undefined
  let scrollTimer = 0

  function overflow() {
    const scrollable = nav.scrollHeight > nav.clientHeight + 1
    nav.classList.toggle("is-scrollable", scrollable)
    nav.classList.toggle("at-start", nav.scrollTop <= 1)
    nav.classList.toggle("at-end", nav.scrollTop + nav.clientHeight >= nav.scrollHeight - 1)
  }

  function keepVisible() {
    const first = nav.querySelector<HTMLElement>(".in-view")
    if (first) {
      const top = first.offsetTop
      const bottom = top + first.offsetHeight
      if (top < nav.scrollTop + BUFFER) nav.scrollTop = Math.max(0, top - BUFFER)
      else if (bottom > nav.scrollTop + nav.clientHeight - BUFFER) nav.scrollTop = bottom - nav.clientHeight + BUFFER
    }
    overflow()
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) buttons.get(entry.target)?.classList.toggle("in-view", entry.isIntersecting)
      if (!hovering) keepVisible()
    },
    { root: host.scroll },
  )

  function measure() {
    metrics = [...nav.children].map((button) => ({
      button: button as HTMLButtonElement,
      fill: button.firstElementChild as HTMLElement,
      center: (button as HTMLElement).offsetTop + (button as HTMLElement).offsetHeight / 2,
      touched: false,
    }))
    const base = Math.max(1, metrics.find((m) => m.button.dataset.depth === "0")?.fill.offsetWidth ?? 1)
    maxScale = Math.max(1, nav.clientWidth / base)
    overflow()
  }

  function sync() {
    queued = 0
    const wanted: { el: Element; depth: number; label: string }[] = []
    host.content().querySelectorAll(":scope > .turn").forEach((turn, i) => {
      const prompt = turn.querySelector(":scope > .turn-body > .prompt .text")?.textContent?.trim().split("\n", 1)[0]
      wanted.push({ el: turn, depth: 0, label: `${String(i + 1).padStart(2, "0")}  ${prompt || "start of the session"}` })
      for (const heading of turn.querySelectorAll(":scope > .turn-body > .prose > :is(h3, h4)")) {
        wanted.push({ el: heading, depth: 1, label: heading.textContent ?? "" })
      }
    })
    const keep = new Set(wanted.map((w) => w.el))
    for (const [el] of buttons) {
      if (keep.has(el)) continue
      observer.unobserve(el)
      buttons.delete(el)
    }
    const order = wanted.map((w) => {
      let button = buttons.get(w.el)
      if (!button) {
        button = h("button", { type: "button", class: "toc-item", tabindex: -1, "data-depth": w.depth }, h("span", { class: "fill" }))
        buttons.set(w.el, button)
        targets.set(button, w.el)
        observer.observe(w.el)
      }
      button.setAttribute("aria-label", w.label)
      return button
    })
    if (order.length !== nav.children.length || order.some((b, i) => nav.children[i] !== b)) nav.replaceChildren(...order)
    toc.hidden = order.length < 2
    if (!toc.hidden) measure()
  }

  function firstAt(center: number): number {
    let low = 0
    let high = metrics.length
    while (low < high) {
      const mid = (low + high) >> 1
      if (metrics[mid].center < center) low = mid + 1
      else high = mid
    }
    return low
  }

  function reset(metric: Metric) {
    metric.button.classList.remove("is-active")
    metric.fill.style.transform = ""
  }

  function update() {
    frame = 0
    at = still.matches ? goal : at + (goal - at) * LERP
    const y = at + nav.scrollTop
    const next: Metric[] = []
    for (let i = firstAt(y - RADIUS); i < firstAt(y + RADIUS); i++) {
      const metric = metrics[i]
      const distance = y - metric.center
      const scale = 1 + (maxScale - 1) * Math.exp(-(distance * distance) / (2 * SIGMA * SIGMA))
      metric.fill.style.transform = `scaleX(${scale.toFixed(3)})`
      metric.touched = true
      next.push(metric)
    }
    for (const metric of touched) if (!metric.touched) reset(metric)
    for (const metric of next) metric.touched = false
    touched = next

    const after = firstAt(y)
    const before = metrics[after - 1]
    const nearest = !before ? metrics[after] : !metrics[after] || y - before.center <= metrics[after].center - y ? before : metrics[after]
    if (nearest) {
      if (nearest.button !== active) {
        active?.classList.remove("is-active")
        active = nearest.button
        active.classList.add("is-active")
        label.textContent = active.getAttribute("aria-label")
      }
      toc.style.setProperty("--toc-label-y", `${at.toFixed(1)}px`)
      label.classList.add("is-visible")
    }
    if (hovering && Math.abs(goal - at) > EPSILON) schedule()
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update)
  }

  function leave() {
    hovering = false
    toc.classList.remove("is-hovering")
    host.stage.classList.remove("toc-hovering", "toc-scrolling")
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    active?.classList.remove("is-active")
    active = undefined
    label.classList.remove("is-visible")
    for (const metric of touched) reset(metric)
    touched = []
  }

  nav.addEventListener("mouseenter", (event) => {
    hovering = true
    toc.classList.add("is-hovering")
    host.stage.classList.add("toc-hovering")
    measure()
    navTop = nav.getBoundingClientRect().top
    goal = at = event.clientY - navTop
    schedule()
  })
  nav.addEventListener("mouseleave", leave)
  nav.addEventListener(
    "pointermove",
    (event) => {
      goal = event.clientY - navTop
      if (hovering) schedule()
    },
    { passive: true },
  )
  nav.addEventListener(
    "scroll",
    () => {
      overflow()
      if (hovering) schedule()
    },
    { passive: true },
  )
  nav.addEventListener("click", (event) => {
    const button = active ?? (event.target as HTMLElement).closest<HTMLButtonElement>(".toc-item")
    const target = button && targets.get(button)
    if (!target) return
    const top = host.scroll.scrollTop + target.getBoundingClientRect().top - host.scroll.getBoundingClientRect().top - 8
    host.scroll.scrollTo({ top, behavior: still.matches ? "auto" : "smooth" })
    leave()
  })
  host.scroll.addEventListener(
    "scroll",
    () => {
      if (!hovering) return
      host.stage.classList.add("toc-scrolling")
      clearTimeout(scrollTimer)
      scrollTimer = window.setTimeout(() => host.stage.classList.remove("toc-scrolling"), SCROLL_END_MS)
    },
    { passive: true },
  )
  new ResizeObserver(() => {
    if (!toc.hidden && !hovering) measure()
  }).observe(nav)

  return {
    refresh() {
      if (!queued) queued = requestAnimationFrame(sync)
    },
  }
}
