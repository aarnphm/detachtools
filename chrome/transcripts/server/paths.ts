import { homedir } from "node:os"
import { dirname, join } from "node:path"

export const PORT = Number(process.env.TRANSCRIPTS_PORT ?? 4517)
export const ROOT = dirname(import.meta.dir)
export const EXT = process.env.TRANSCRIPTS_EXT ?? join(ROOT, "ext")
export const STATE = process.env.TRANSCRIPTS_STATE ?? join(homedir(), ".local", "state", "transcripts")
export const HOST = "dev.aarnphm.transcripts"
export const HEALTH = `http://127.0.0.1:${PORT}/api/health`

export interface Health {
  ok: boolean
  pid: number
}

export async function health(): Promise<Health | undefined> {
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(600) })
    return res.ok ? ((await res.json()) as Health) : undefined
  } catch {
    return undefined
  }
}
