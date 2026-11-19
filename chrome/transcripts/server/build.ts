import { join } from "node:path"
import { deflateSync } from "node:zlib"
import { EXT, HOST, PORT, ROOT } from "./paths"

const tilde = (path: string) => path.replace(process.env.HOME ?? "\0", "~")

const PAPER = [0xff, 0xfc, 0xf0]
const INK = [0x10, 0x0f, 0x0f]
const STEM = [0x6f, 0x6e, 0x69]
const SALMON = [0xfd, 0xb2, 0xa2]

const MARKS: [number, number, number, number, number[]][] = [
  [2, 3, 13, 4, INK],
  [3, 5, 3, 11, STEM],
  [4, 8, 5, 8, STEM],
  [4, 11, 5, 11, STEM],
  [6, 7, 12, 8, INK],
  [6, 10, 10, 11, SALMON],
]

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(new TextEncoder().encode(type), 4)
  out.set(data, 8)
  view.setUint32(8 + data.length, Bun.hash.crc32(out.subarray(4, 8 + data.length)))
  return out
}

function icon(size: number): Uint8Array {
  const scale = size / 16
  const raw = new Uint8Array(size * (1 + size * 3))
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = Math.floor(x / scale)
      const gy = Math.floor(y / scale)
      const mark = MARKS.find(([x0, y0, x1, y1]) => gx >= x0 && gx <= x1 && gy >= y0 && gy <= y1)
      raw.set(mark ? mark[4] : PAPER, y * (1 + size * 3) + 1 + x * 3)
    }
  }
  const header = new Uint8Array(13)
  const view = new DataView(header.buffer)
  view.setUint32(0, size)
  view.setUint32(4, size)
  header.set([8, 2, 0, 0, 0], 8)
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(raw)), chunk("IEND", new Uint8Array())]
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

export async function build() {
  const result = await Bun.build({
    entrypoints: [join(ROOT, "ui", "main.ts")],
    target: "browser",
    format: "esm",
    define: {
      SERVER_COMMAND: JSON.stringify(`bun ${tilde(join(ROOT, "server", "main.ts"))}`),
      INSTALL_COMMAND: JSON.stringify(`bun ${tilde(join(ROOT, "server", "install.ts"))}`),
      HOST_NAME: JSON.stringify(HOST),
      API_PORT: String(PORT),
    },
  })
  if (!result.success) throw new AggregateError(result.logs, "ui build failed")
  await Bun.write(join(EXT, "view.js"), await result.outputs[0].text())
  await Promise.all([16, 32, 48, 128].map((size) => Bun.write(join(EXT, `icon-${size}.png`), icon(size))))
}
