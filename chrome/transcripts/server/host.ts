import { spawn } from "node:child_process"
import { mkdirSync, openSync, rmSync, statSync } from "node:fs"
import { join } from "node:path"
import { PORT, STATE, health } from "./paths"

const LOG = join(STATE, "server.log")
const LOCK = join(STATE, "start.lock")
const LOCK_STALE_MS = 15_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

function claim(): boolean {
  try {
    mkdirSync(LOCK)
    return true
  } catch {
    const age = Date.now() - (statSync(LOCK, { throwIfNoEntry: false })?.mtimeMs ?? 0)
    if (age < LOCK_STALE_MS) return false
    rmSync(LOCK, { recursive: true, force: true })
    return claim()
  }
}

async function start() {
  const running = await health()
  if (running) return { ok: true, started: false, pid: running.pid }
  mkdirSync(STATE, { recursive: true })
  const mine = claim()
  try {
    if (mine) {
      const log = openSync(LOG, "a")
      spawn(process.execPath, [join(import.meta.dir, "main.ts")], { detached: true, stdio: ["ignore", log, log] }).unref()
    }
    for (let i = 0; i < 80; i++) {
      await Bun.sleep(100)
      const up = await health()
      if (up) return { ok: true, started: mine, pid: up.pid }
    }
    return { ok: false, error: `the server did not answer on port ${PORT}. its log is ${LOG}` }
  } finally {
    if (mine) rmSync(LOCK, { recursive: true, force: true })
  }
}

async function stop() {
  const running = await health()
  if (!running) return { ok: true, stopped: false }
  process.kill(running.pid, "SIGTERM")
  for (let i = 0; i < 40; i++) {
    await Bun.sleep(50)
    if (!(await health())) return { ok: true, stopped: true }
  }
  return { ok: false, error: `process ${running.pid} did not stop` }
}

async function handle(message: { cmd?: string }) {
  if (message.cmd === "start") return start()
  if (message.cmd === "stop") return stop()
  if (message.cmd === "status") {
    const running = await health()
    return { ok: true, running: !!running, pid: running?.pid }
  }
  return { ok: false, error: `unknown command ${String(message.cmd)}` }
}

function reply(value: unknown) {
  const body = encoder.encode(JSON.stringify(value))
  const frame = new Uint8Array(4 + body.length)
  new DataView(frame.buffer).setUint32(0, body.length, true)
  frame.set(body, 4)
  process.stdout.write(frame)
}

let pending = new Uint8Array(0)
for await (const chunk of Bun.stdin.stream()) {
  const joined = new Uint8Array(pending.length + chunk.length)
  joined.set(pending)
  joined.set(chunk, pending.length)
  pending = joined
  while (pending.length >= 4) {
    const size = new DataView(pending.buffer, pending.byteOffset).getUint32(0, true)
    if (pending.length < 4 + size) break
    const text = decoder.decode(pending.subarray(4, 4 + size))
    pending = pending.subarray(4 + size)
    let message: { cmd?: string }
    try {
      message = JSON.parse(text)
    } catch {
      reply({ ok: false, error: "the message was not JSON" })
      continue
    }
    reply(await handle(message).catch((e) => ({ ok: false, error: String(e) })))
  }
}
