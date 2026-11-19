import type { Item, Patch, ToolItem } from "../server/types"

export type Kind = "shell" | "read" | "edit" | "write" | "agent" | "todo" | "other"

const KINDS: Record<string, Kind> = {
  bash: "shell",
  shell: "shell",
  run_command: "shell",
  exec_command: "shell",
  read: "read",
  read_file: "read",
  view_file: "read",
  view_image: "read",
  edit: "edit",
  multiedit: "edit",
  notebookedit: "edit",
  edit_file: "edit",
  replace_file_content: "edit",
  patch: "edit",
  write: "write",
  write_file: "write",
  write_to_file: "write",
  agent: "agent",
  task: "agent",
  invoke_subagent: "agent",
  todowrite: "todo",
  update_plan: "todo",
}

const NOTES: Record<string, string> = {
  meta: "injected",
  task: "task",
  stdout: "stdout",
  recap: "recap",
  summary: "summary",
  system: "system",
}

export function label(name: string): string {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(name)
  const short = mcp ? mcp[2] : name.slice(name.lastIndexOf("/") + 1)
  return short.toLowerCase()
}

export const kind = (name: string): Kind => KINDS[label(name)] ?? "other"

export function fields(input: unknown): Record<string, unknown> {
  return input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
}

export function rel(path: string, cwd?: string): string {
  if (cwd && path.startsWith(`${cwd}/`)) return path.slice(cwd.length + 1)
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, "~")
}

function pick(input: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = input[key]
    if (typeof value === "string" && value.trim()) return value
  }
  return undefined
}

export function pathOf(tool: ToolItem): string | undefined {
  const input = fields(tool.input)
  const files = input.files
  return pick(input, ["file_path", "path", "notebook_path", "AbsolutePath", "TargetFile"]) ?? (Array.isArray(files) ? String(files[0] ?? "") : undefined) ?? tool.patch?.[0]?.file
}

export function commandOf(tool: ToolItem): string {
  return pick(fields(tool.input), ["command", "CommandLine", "cmd"]) ?? ""
}

export function summary(tool: ToolItem, cwd?: string): string {
  const input = fields(tool.input)
  const first = (text: string | undefined) => (text ?? "").trim().split("\n", 1)[0]
  switch (kind(tool.name)) {
    case "shell":
      return first(pick(input, ["description", "toolSummary"]) ?? commandOf(tool))
    case "read":
    case "edit":
    case "write": {
      const path = pathOf(tool)
      const extra = Array.isArray(input.files) && input.files.length > 1 ? ` and ${input.files.length - 1} more` : ""
      return path ? rel(path, cwd) + extra : first(pick(input, ["toolSummary", "description"]))
    }
    case "agent":
      return first(pick(input, ["description", "toolSummary", "prompt"]))
    case "todo": {
      const list = (input.todos ?? input.items ?? input.plan) as unknown
      return Array.isArray(list) ? `${list.length} ${list.length === 1 ? "item" : "items"}` : ""
    }
    default: {
      if (typeof tool.input === "string") return first(tool.input)
      const named = pick(input, ["toolSummary", "description", "pattern", "query", "url", "skill", "prompt", "title"])
      if (named) return first(named)
      const queries = input.queries
      if (Array.isArray(queries)) return queries.join(", ")
      return first(Object.values(input).find((v): v is string => typeof v === "string"))
    }
  }
}

export function stepName(item: Item): string {
  if (item.k === "tool") return label(item.name)
  if (item.k === "think") return "thinking"
  if (item.k === "note") return NOTES[item.kind] ?? item.kind
  return item.k
}

export function diffstat(patch: Patch[] | undefined): [number, number] | undefined {
  if (!patch?.length) return undefined
  let add = 0
  let del = 0
  for (const file of patch) {
    for (const hunk of file.hunks) {
      for (const line of hunk.lines) {
        if (line[0] === "+") add++
        else if (line[0] === "-") del++
      }
    }
  }
  return [add, del]
}

export function duration(ms: number | undefined): string {
  if (ms === undefined || ms < 100) return ""
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(Math.round(s % 60)).padStart(2, "0")}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`
}

const clockFormat = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" })
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" })
const fullFormat = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium" })

export const clock = (t: number) => clockFormat.format(t)
export const stamp = (t: number) => fullFormat.format(t)
export const day = (t: number) => dayFormat.format(t).toLowerCase()

export function age(t: number, now = Date.now()): string {
  const s = Math.max(0, (now - t) / 1000)
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d`
  return day(t)
}

export function dayGroup(t: number, now = Date.now()): string {
  const start = new Date(now).setHours(0, 0, 0, 0)
  if (t >= start) return "today"
  if (t >= start - 86400000) return "yesterday"
  return day(t)
}
