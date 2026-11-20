import { existsSync } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { homedir, platform } from "node:os"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { RG } from "./search"

const HOME = homedir()
const MAX_BYTES = 2_000_000
const INDEX_TTL_MS = 120_000
const MDFIND = platform() === "darwin" && existsSync("/usr/bin/mdfind") ? "/usr/bin/mdfind" : undefined
const MARKDOWN = /\.(?:md|markdown)$/i

export interface Note {
  path: string
  title: string
  text: string
  updatedAt: number
}

const indexes = new Map<string, { at: number; files?: string[]; building?: Promise<string[]> }>()

function vault(cwd: string | undefined): string | undefined {
  for (let dir = cwd; dir?.startsWith(HOME) && dir !== HOME; dir = dirname(dir)) {
    if (existsSync(join(dir, ".obsidian"))) return dir
  }
  return cwd?.startsWith(HOME) ? cwd : undefined
}

async function scan(root: string): Promise<string[]> {
  if (RG) {
    const proc = Bun.spawn([RG, "--files", "--null", "--glob", "*.md", "--glob", "*.markdown", "--", root], { stdout: "pipe", stderr: "ignore" })
    const list = (await new Response(proc.stdout).text()).split("\0").filter(Boolean)
    await proc.exited
    return list
  }
  const list: string[] = []
  for await (const rel of new Bun.Glob("**/*.{md,markdown}").scan({ cwd: root })) {
    if (!rel.includes("node_modules/")) list.push(join(root, rel))
  }
  return list
}

function files(root: string): Promise<string[]> {
  const hit = indexes.get(root) ?? { at: 0 }
  indexes.set(root, hit)
  if (!hit.building && (!hit.files || Date.now() - hit.at > INDEX_TTL_MS)) {
    hit.building = scan(root)
      .catch(() => [] as string[])
      .then((list) => {
        hit.files = list
        hit.at = Date.now()
        hit.building = undefined
        return list
      })
  }
  return hit.files ? Promise.resolve(hit.files) : hit.building!
}

async function spotlight(root: string, leaf: string): Promise<string[]> {
  if (!MDFIND) return []
  const proc = Bun.spawn([MDFIND, "-onlyin", root, "-name", leaf], { stdout: "pipe", stderr: "ignore" })
  const found = (await new Response(proc.stdout).text()).split("\n").filter((path) => basename(path).toLowerCase() === leaf)
  await proc.exited
  return found
}

export function warmNotes(cwd: string | undefined): void {
  const root = vault(cwd)
  if (root) void files(root)
}

async function allowed(path: string): Promise<string | undefined> {
  if (!MARKDOWN.test(path)) return undefined
  const real = await realpath(path).catch(() => undefined)
  if (!real || !(real === HOME || real.startsWith(HOME + sep))) return undefined
  const info = await stat(real).catch(() => undefined)
  return info?.isFile() && info.size <= MAX_BYTES ? real : undefined
}

function memoryDir(cwd: string | undefined): string | undefined {
  return cwd ? join(HOME, ".claude", "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"), "memory") : undefined
}

export async function findNote(target: string, cwd: string | undefined, from: string | undefined): Promise<{ note?: Note; tried: string[] }> {
  const tried: string[] = []
  const name = target.trim().replace(/^~(?=\/)/, HOME)
  if (!name) return { tried }
  const withExt = MARKDOWN.test(name) ? name : `${name}.md`
  const root = vault(cwd)
  const candidates: string[] = []
  if (isAbsolute(withExt)) candidates.push(withExt)
  else {
    for (const base of [from && dirname(from), cwd, root]) if (base) candidates.push(resolve(base, withExt))
  }
  for (const path of candidates) {
    tried.push(path)
    const real = await allowed(path)
    if (real) return { note: await load(real), tried }
  }
  if (isAbsolute(withExt)) return { tried }
  const wanted = withExt.toLowerCase()
  const leaf = basename(wanted)
  const near = [from && dirname(from) + sep, cwd && cwd + sep]
  const rank = (path: string) => {
    const at = near.findIndex((dir) => dir && path.startsWith(dir))
    return at < 0 ? near.length : at
  }
  const pick = async (pool: string[]) => {
    const matches = pool
      .filter((path) => {
        const lower = path.toLowerCase()
        return wanted.includes("/") ? lower.endsWith(`/${wanted}`) : basename(lower) === leaf
      })
      .sort((a, b) => rank(a) - rank(b) || a.length - b.length)
    for (const path of matches) {
      const real = await allowed(path)
      if (real) return load(real)
    }
    return undefined
  }
  const memory = memoryDir(cwd)
  if (root) {
    const ready = indexes.get(root)?.files
    const listing = files(root)
    const quick = ready ? undefined : await pick(await spotlight(root, leaf))
    const note = quick ?? (await pick(await listing))
    if (note) return { note, tried }
    tried.push(`${root}/**/${basename(withExt)}`)
  }
  if (memory && existsSync(memory)) {
    const note = await pick(await scan(memory))
    if (note) return { note, tried }
    tried.push(`${memory}/${basename(withExt)}`)
  }
  return { tried }
}

async function load(path: string): Promise<Note> {
  const text = await Bun.file(path).text()
  const info = await stat(path)
  const heading = /^#\s+(.+)$/m.exec(text.replace(/^---\n[\s\S]*?\n---/, ""))?.[1]
  return { path, title: heading?.trim() || basename(path).replace(MARKDOWN, ""), text, updatedAt: info.mtimeMs }
}
