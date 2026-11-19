export type Source = "claude" | "argon" | "codex"

export interface SessionMeta {
  source: Source
  id: string
  title: string
  path: string
  updatedAt: number
  cwd?: string
  branch?: string
  model?: string
  parent?: string
}

export interface Hunk {
  o: number
  n: number
  lines: string[]
}

export interface Patch {
  file: string
  hunks: Hunk[]
}

interface Base {
  id: string
  t?: number
}

export interface UserItem extends Base {
  k: "user"
  text: string
  images?: number
}

export interface TextItem extends Base {
  k: "text"
  text: string
}

export interface ThinkItem extends Base {
  k: "think"
  text: string
  ms?: number
}

export interface ToolItem extends Base {
  k: "tool"
  name: string
  input: unknown
  status: "run" | "ok" | "err"
  out?: string
  outLen?: number
  ms?: number
  agent?: string
  patch?: Patch[]
}

export type NoteKind = "compact" | "abort" | "error" | "summary" | "meta" | "task" | "stdout" | "recap" | "system"

export interface NoteItem extends Base {
  k: "note"
  kind: NoteKind
  text: string
  detail?: string
}

export type Item = UserItem | TextItem | ThinkItem | ToolItem | NoteItem

export interface Change {
  items: Item[]
  meta: boolean
  reset?: boolean
}

export interface Reader {
  meta: SessionMeta
  items: Map<string, Item>
  watch: string[]
  poll(): Promise<Change>
}

export interface Snapshot {
  meta: SessionMeta
  items: Item[]
}

export interface SessionsDelta {
  upsert: SessionMeta[]
  remove: string[]
}
