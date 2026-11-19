export type Child = Node | string | null | undefined | false
type Attrs = Record<string, string | number | boolean | undefined> | null

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag)
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === undefined || value === false) continue
    if (name === "class") el.className = String(value)
    else el.setAttribute(name, value === true ? "" : String(value))
  }
  el.append(...children.filter((c): c is Node | string => c !== null && c !== undefined && c !== false))
  return el
}

export interface ClampOptions {
  tag?: "pre" | "div"
  cls?: string
  total?: number
  more?: () => Promise<string>
  render?: (text: string) => Child[]
}

export function clamp(text: string, max: number, opts: ClampOptions = {}): HTMLElement {
  const body = h(opts.tag ?? "pre", { class: opts.cls ?? "pre" })
  const wrap = h("div", { class: "clamp" }, body)
  const button = h("button", { type: "button", class: "more" })
  let full = text
  let open = false
  let pending = opts.more

  const paint = () => {
    const lines = full.split("\n")
    const over = lines.length > max
    const shown = open || !over ? full : lines.slice(0, max).join("\n")
    if (opts.render) body.replaceChildren(...opts.render(shown).filter((c): c is Node | string => !!c))
    else body.textContent = shown
    if (!over && !pending) return button.remove()
    button.textContent = open ? "show less" : pending ? `show all, ${size(opts.total ?? full.length)}` : `show all ${lines.length.toLocaleString("en-US")} lines`
    button.setAttribute("aria-expanded", String(open))
    if (!button.isConnected) wrap.append(button)
  }

  button.addEventListener("click", async () => {
    if (!open && pending) {
      button.disabled = true
      try {
        full = await pending()
        pending = undefined
      } catch {
        button.textContent = "could not load the rest. try again"
        button.disabled = false
        return
      }
      button.disabled = false
    }
    open = !open
    paint()
  })

  paint()
  return wrap
}

export function size(chars: number): string {
  return chars < 1024 ? `${chars} B` : chars < 1048576 ? `${(chars / 1024).toFixed(1)} KB` : `${(chars / 1048576).toFixed(1)} MB`
}
