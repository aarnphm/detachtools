import type { Item, NoteItem, Patch, Snapshot, ToolItem, UserItem } from "../server/types"
import { type Child, clamp, h } from "./dom"
import { markdown } from "./md"
import { ansi, plain } from "./ansi"
import { clock, commandOf, diffstat, duration, fields, kind, label, pathOf, rel, stamp, stepName, summary } from "./tools"

export interface Host {
  get(path: string): Promise<any>
  ref(): { source: string; id: string } | undefined
  cwd(): string | undefined
  live(): boolean
}

const RULES = new Set(["compact", "abort", "error"])
const PROMPT_LINES = 16
const OUTPUT_LINES = 30

export class Transcript {
  readonly el: HTMLElement
  readonly openSteps = new Set<string>()
  readonly openRuns = new Set<string>()
  turns = 0
  steps = 0
  private items = new Map<string, Item>()
  private where = new Map<string, Run | HTMLElement>()
  private runs: Run[] = []
  private body: HTMLElement | undefined
  private run: Run | undefined

  constructor(readonly host: Host, readonly agent?: string) {
    this.el = h("div", { class: "transcript" })
  }

  reset(items: Item[]) {
    this.el.replaceChildren()
    this.items.clear()
    this.where.clear()
    this.runs = []
    this.body = undefined
    this.run = undefined
    this.turns = 0
    this.steps = 0
    for (const item of items) this.add(item, false)
    for (const run of this.runs) run.settle()
  }

  upsert(items: Item[]) {
    for (const item of items) {
      if (this.items.has(item.id)) this.update(item)
      else this.add(item, true)
    }
  }

  expand(open: boolean) {
    for (const run of this.runs) run.toggle(open)
  }

  refresh() {
    for (const run of this.runs) run.refresh()
  }

  private turn(item: UserItem | undefined) {
    this.turns++
    const mark = h("div", { class: "turn-mark" }, h("b", null, String(this.turns).padStart(2, "0")))
    if (item?.t) mark.append(h("time", { datetime: new Date(item.t).toISOString(), title: stamp(item.t) }, clock(item.t)))
    this.body = h("div", { class: "turn-body" })
    if (item) {
      const prompt = this.prompt(item)
      this.body.append(prompt)
      this.where.set(item.id, prompt)
    }
    this.el.append(h("section", { class: "turn", "aria-label": `turn ${this.turns}` }, mark, this.body))
    this.run = undefined
  }

  private prompt(item: UserItem): HTMLElement {
    const el = h("div", { class: "prompt", "data-id": item.id, "data-cmd": /^[/!]\S/.test(item.text) && !item.text.includes("\n") })
    if (item.text) el.append(clamp(item.text, PROMPT_LINES, { tag: "div", cls: "text" }))
    if (item.images) el.append(h("span", { class: "attach" }, `${item.images} ${item.images === 1 ? "image" : "images"} attached`))
    return el
  }

  private add(item: Item, fresh: boolean) {
    this.items.set(item.id, item)
    if (item.k === "user") return this.turn(item)
    if (!this.body) this.turn(undefined)
    if (item.k === "text" || (item.k === "note" && RULES.has(item.kind))) {
      const el = item.k === "text" ? prose(item.id, item.text) : rule(item)
      if (fresh) el.classList.add("fresh")
      this.body!.append(el)
      this.where.set(item.id, el)
      this.run = undefined
      return
    }
    if (!this.run) {
      this.run = new Run(this, item.id)
      this.runs.push(this.run)
      this.body!.append(this.run.el)
    }
    if (item.k === "tool") this.steps++
    this.where.set(item.id, this.run)
    this.run.add(item, fresh)
  }

  private update(item: Item) {
    this.items.set(item.id, item)
    const at = this.where.get(item.id)
    if (at instanceof Run) return at.update(item)
    if (!at) return
    const next = item.k === "user" ? this.prompt(item) : item.k === "text" ? prose(item.id, item.text) : item.k === "note" ? rule(item) : undefined
    if (!next) return
    at.replaceWith(next)
    this.where.set(item.id, next)
  }

  private path(verb: string, itemId?: string): string {
    const ref = this.host.ref()!
    const item = itemId ? `/${encodeURIComponent(itemId)}` : ""
    return `${verb}/${ref.source}/${encodeURIComponent(ref.id)}${item}${this.agent ? `?agent=${this.agent}` : ""}`
  }

  private output(tool: ToolItem): HTMLElement {
    const more = tool.outLen ? () => this.host.get(this.path("item", tool.id)).then((full: ToolItem) => full.out ?? "") : undefined
    return clamp(tool.out ?? "", OUTPUT_LINES, { total: tool.outLen, more, render: ansi })
  }

  private subagent(tool: ToolItem): HTMLElement {
    const box = h("div", { class: "sub" }, h("p", { class: "quiet pad" }, "reading the subagent transcript"))
    const ref = this.host.ref()!
    this.host
      .get(`items/${ref.source}/${encodeURIComponent(ref.id)}?agent=${tool.agent}`)
      .then((snap: Snapshot) => {
        const child = new Transcript(this.host, tool.agent)
        child.reset(snap.items)
        box.replaceChildren(child.el)
      })
      .catch(() => box.replaceChildren(h("p", { class: "quiet pad" }, "the subagent transcript is not on disk")))
    return box
  }

  detail(item: Item): Child[] {
    if (item.k === "think") return [clamp(item.text, 40, { tag: "div", cls: "think" })]
    if (item.k === "note") return [clamp(item.detail ?? item.text, OUTPUT_LINES, { render: ansi })]
    if (item.k !== "tool") return []
    const input = fields(item.input)
    const what = kind(item.name)
    const out: Child[] = []
    if (what === "shell") out.push(block("command", clamp(commandOf(item), 12)))
    else if (what === "edit" && item.patch?.length) out.push(...item.patch.map((p) => diff(p, this.host.cwd())))
    else if (what === "write" && typeof input.content === "string") out.push(block(rel(pathOf(item) ?? "content", this.host.cwd()), clamp(input.content, OUTPUT_LINES)))
    else if (what === "todo") out.push(todo(input))
    else if (what === "agent" && item.agent) out.push(block(`subagent ${input.subagent_type ?? ""}`.trim(), this.subagent(item)))
    else if (typeof item.input === "string") out.push(block("input", clamp(item.input, 12)))
    else if (Object.keys(input).length) out.push(block("input", table(input)))
    const failed = item.status === "err"
    if (item.out?.trim()) {
      if (!(what === "edit" && item.patch?.length && !failed)) out.push(block(failed ? "error" : what === "agent" ? "result" : "output", this.output(item)))
    } else if (item.status === "run") out.push(h("p", { class: "quiet" }, this.host.live() ? "still running" : "the transcript has no result for this step"))
    else if (what !== "edit" && what !== "write" && what !== "todo") out.push(h("p", { class: "quiet" }, "no output"))
    return out
  }
}

function prose(id: string, text: string): HTMLElement {
  return h("div", { class: "prose", "data-id": id }, markdown(text))
}

function rule(item: NoteItem): HTMLElement {
  return h("div", { class: "rule", "data-id": item.id, "data-kind": item.kind, title: item.t ? stamp(item.t) : undefined }, plain(item.text))
}

function block(name: string, body: Child, aside?: Child): HTMLElement {
  return h("div", { class: "blk" }, h("div", { class: "blk-label" }, h("span", null, name), aside), body)
}

function statNode(patch: Patch[] | undefined): HTMLElement | undefined {
  const stat = diffstat(patch)
  if (!stat) return undefined
  return h("span", { class: "stat" }, h("span", { class: "plus" }, `+${stat[0]}`), " ", h("span", { class: "minus" }, `−${stat[1]}`))
}

function diff(patch: Patch, cwd?: string): HTMLElement {
  const lines = patch.hunks.flatMap((hunk) => [
    h("span", { class: "l hunk" }, `@@ -${hunk.o} +${hunk.n} @@`),
    ...hunk.lines.map((line) => h("span", { class: `l ${line[0] === "+" ? "add" : line[0] === "-" ? "del" : ""}` }, line || " ")),
  ])
  return block(rel(patch.file, cwd), h("pre", { class: "pre diff" }, ...lines), statNode([patch]))
}

function table(input: Record<string, unknown>): HTMLElement {
  const dl = h("dl", { class: "fields" })
  for (const [key, value] of Object.entries(input)) {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2)
    dl.append(h("dt", null, key), h("dd", null, text.includes("\n") ? clamp(text, 12, { tag: "div", cls: "" }) : text))
  }
  return dl
}

function todo(input: Record<string, unknown>): HTMLElement {
  const list = (input.todos ?? input.items ?? input.plan ?? []) as { content?: string; step?: string; status?: string }[]
  const words: Record<string, string> = { completed: "done", in_progress: "doing", pending: "todo" }
  return h(
    "ul",
    { class: "todo" },
    ...(Array.isArray(list) ? list : []).map((entry) =>
      h("li", { "data-status": entry.status }, h("span", null, words[entry.status ?? ""] ?? entry.status ?? ""), h("span", null, entry.content ?? entry.step ?? "")),
    ),
  )
}

class Run {
  readonly el = h("div", { class: "run" })
  private head = h("button", { type: "button", class: "run-head", "aria-expanded": "false" })
  private tree = h("ul", { class: "tree" })
  private items: Item[] = []
  private nodes = new Map<string, HTMLElement>()
  private built = false
  private open: boolean

  constructor(private tx: Transcript, private key: string) {
    this.open = tx.openRuns.has(key)
    this.head.addEventListener("click", () => this.toggle())
    this.el.append(this.head, this.tree)
  }

  add(item: Item, fresh: boolean) {
    this.items.push(item)
    if (this.built) this.tree.append(this.node(item, fresh))
    else if (fresh && this.items.length === 1) this.build()
    if (fresh) this.paint()
  }

  settle() {
    if (!this.built && (this.items.length === 1 || this.open)) this.build()
    this.paint()
  }

  update(item: Item) {
    const at = this.items.findIndex((i) => i.id === item.id)
    if (at < 0) return
    this.items[at] = item
    if (this.built) {
      const old = this.nodes.get(item.id)
      old?.replaceWith(this.node(item, false))
    }
    this.paint()
  }

  refresh() {
    const waiting = this.items.filter((i) => i.k === "tool" && i.status === "run")
    if (!waiting.length) return
    for (const item of waiting) if (this.built) this.nodes.get(item.id)?.replaceWith(this.node(item, false))
    this.paint()
  }

  toggle(open = !this.open) {
    this.open = open
    if (open) this.tx.openRuns.add(this.key)
    else this.tx.openRuns.delete(this.key)
    if (open && !this.built) this.build()
    this.paint()
  }

  private build() {
    this.built = true
    this.tree.replaceChildren(...this.items.map((item) => this.node(item, false)))
  }

  private paint() {
    const single = this.items.length === 1
    this.el.toggleAttribute("data-single", single)
    this.el.toggleAttribute("data-open", this.open && !single)
    if (this.items.every((i) => i.k === "think")) this.el.setAttribute("data-only", "think")
    else this.el.removeAttribute("data-only")
    this.head.setAttribute("aria-expanded", String(this.open))

    const counts = new Map<string, number>()
    let failed = 0
    let running: ToolItem | undefined
    for (const item of this.items) {
      const name = stepName(item)
      counts.set(name, (counts.get(name) ?? 0) + 1)
      if (item.k === "tool" && item.status === "err") failed++
      if (item.k === "tool" && item.status === "run") running = item
    }
    const ranked = [...counts].sort((a, b) => b[1] - a[1])
    const shown = ranked.slice(0, 4).map(([name, n]) => `${name} ${n}`)
    if (ranked.length > 4) shown.push(`${ranked.length - 4} more`)
    const live = running && this.tx.host.live()
    const mix = live ? `${label(running!.name)} ${plain(summary(running!, this.tx.host.cwd()))}` : shown.join(" · ")
    const first = this.items[0]?.t
    const tail = this.items[this.items.length - 1]
    const end = tail?.t !== undefined ? tail.t + ((tail.k === "tool" || tail.k === "think" ? tail.ms : 0) ?? 0) : undefined
    this.head.replaceChildren(
      h("span", { class: "caret" }),
      h("span", { class: "count" }, `${this.items.length} steps`),
      h("span", { class: "mix" }, mix),
      live ? h("span", { class: "flag", "data-flag": "run" }, "running") : "",
      failed ? h("span", { class: "flag", "data-flag": "err" }, `${failed} failed`) : "",
      h("span", { class: "dur" }, first !== undefined && end !== undefined ? duration(end - first) : ""),
    )
  }

  private node(item: Item, fresh: boolean): HTMLElement {
    const li = h("li", { class: fresh ? "node fresh" : "node", "data-id": item.id, "data-k": item.k })
    const cells: Child[] = []
    const cwd = this.tx.host.cwd()
    const when = item.t ? stamp(item.t) : undefined
    if (item.k === "tool") {
      const text = plain(summary(item, cwd))
      cells.push(h("span", { class: "name", title: item.name }, label(item.name)), h("span", { class: "sum", title: text }, text), statNode(item.patch))
      if (item.status === "err") cells.push(h("span", { class: "flag", "data-flag": "err" }, "failed"))
      else if (item.status === "run") cells.push(this.tx.host.live() ? h("span", { class: "flag", "data-flag": "run" }, "running") : h("span", { class: "flag" }, "no result"))
      cells.push(h("span", { class: "dur", title: when }, duration(item.ms)))
    } else if (item.k === "think") {
      cells.push(h("span", { class: "name" }, "thinking"), h("span", { class: "sum" }, plain(item.text.trim().split("\n", 1)[0])), h("span", { class: "dur", title: when }, duration(item.ms)))
    } else if (item.k === "note") {
      const text = plain(item.text)
      cells.push(h("span", { class: "name" }, stepName(item)), h("span", { class: "sum", title: text }, text), h("span", { class: "dur", title: when }))
    }
    const expandable = item.k !== "note" || (item.detail !== undefined && item.detail.trim() !== item.text.trim())
    if (!expandable) {
      li.append(h("div", { class: "step-head" }, h("span", { class: "caret none" }), ...cells))
    } else {
      const head = h("button", { type: "button", class: "step-head", "aria-expanded": "false" }, h("span", { class: "caret" }), ...cells)
      const body = h("div", { class: "step-body", hidden: true })
      const set = (open: boolean) => {
        head.setAttribute("aria-expanded", String(open))
        body.hidden = !open
        if (open && !body.childNodes.length) body.append(...this.tx.detail(item).filter((c): c is Node | string => !!c))
        if (open) this.tx.openSteps.add(item.id)
        else this.tx.openSteps.delete(item.id)
      }
      head.addEventListener("click", () => set(body.hidden))
      li.append(head, body)
      if (this.tx.openSteps.has(item.id)) set(true)
    }
    this.nodes.set(item.id, li)
    return li
  }
}
