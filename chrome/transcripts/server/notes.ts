import { existsSync } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { homedir } from "node:os"
import { basename, dirname, isAbsolute, join, resolve, sep } from "node:path"
import { RG } from "./search"

const HOME = homedir()
const MAX_BYTES = 2_000_000
const INDEX_TTL_MS = 30_000
const MARKDOWN = /\.(?:md|markdown)$/i

export interface Note {
  path: string
  title: string
  text: string
  updatedAt: number
}

const indexes = new Map<string, { at: number; files: string[] }>()

function vault(cwd: string | undefined): string | undefined {
  for (let dir = cwd; dir?.startsWith(HOME) && dir !== HOME; dir = dirname(dir)) {
    if (existsSync(join(dir, ".obsidian"))) return dir
  }
  return cwd?.startsWith(HOME) ? cwd : undefined
}

async function files(root: string): Promise<string[]> {
  const hit = indexes.get(root)
  if (hit && Date.now() - hit.at < INDEX_TTL_MS) return hit.files
  let list: string[] = []
  if (RG) {
    const proc = Bun.spawn([RG, "--files", "--null", "--glob", "*.md", "--glob", "*.markdown", "--", root], { stdout: "pipe", stderr: "ignore" })
    list = (await new Response(proc.stdout).text()).split("\0").filter(Boolean)
    await proc.exited
  } else {
    for await (const rel of new Bun.Glob("**/*.{md,markdown}").scan({ cwd: root })) {
      if (!rel.includes("node_modules/")) list.push(join(root, rel))
    }
  }
  indexes.set(root, { at: Date.now(), files: list })
  return list
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
  const pools = [root && (await files(root)), memoryDir(cwd) && (await files(memoryDir(cwd)!).catch(() => []))].filter((p): p is string[] => !!p)
  for (const pool of pools) {
    const matches = pool
      .filter((path) => {
        const lower = path.toLowerCase()
        return wanted.includes("/") ? lower.endsWith(`/${wanted}`) : basename(lower) === leaf
      })
      .sort((a, b) => a.length - b.length)
    for (const path of matches) {
      const real = await allowed(path)
      if (real) return { note: await load(real), tried }
    }
  }
  if (root) tried.push(`${root}/**/${basename(withExt)}`)
  return { tried }
}

async function load(path: string): Promise<Note> {
  const text = await Bun.file(path).text()
  const info = await stat(path)
  const heading = /^#\s+(.+)$/m.exec(text.replace(/^---\n[\s\S]*?\n---/, ""))?.[1]
  return { path, title: heading?.trim() || basename(path).replace(MARKDOWN, ""), text, updatedAt: info.mtimeMs }
}
