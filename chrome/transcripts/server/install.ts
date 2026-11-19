import { chmodSync, existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { homedir, platform } from "node:os"
import { join } from "node:path"
import { build } from "./build"
import { EXT, HOST, STATE } from "./paths"

const WRAPPER = join(STATE, "native-host")
const support = join(homedir(), "Library", "Application Support")
const config = join(homedir(), ".config")

const BROWSERS: Record<string, string> =
  platform() === "darwin"
    ? {
        chrome: join(support, "Google", "Chrome"),
        helium: join(support, "net.imput.helium"),
        chromium: join(support, "Chromium"),
        brave: join(support, "BraveSoftware", "Brave-Browser"),
        edge: join(support, "Microsoft Edge"),
        arc: join(support, "Arc", "User Data"),
      }
    : {
        chrome: join(config, "google-chrome"),
        chromium: join(config, "chromium"),
        brave: join(config, "BraveSoftware", "Brave-Browser"),
      }

export function extensionId(dir: string): string {
  const digest = new Bun.CryptoHasher("sha256").update(realpathSync(dir)).digest("hex")
  return [...digest.slice(0, 32)].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("")
}

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`
const flag = (name: string) => {
  const at = process.argv.indexOf(name)
  return at >= 0 ? process.argv[at + 1] : undefined
}

const only = flag("--dir")
const wanted = flag("--browsers")?.split(",")
const unknown = wanted?.filter((name) => !(name in BROWSERS)) ?? []
if (unknown.length) {
  console.error(`unknown browser: ${unknown.join(", ")}. known: ${Object.keys(BROWSERS).join(", ")}`)
  process.exit(2)
}
const targets = only
  ? [only]
  : Object.entries(BROWSERS)
      .filter(([name, dir]) => (wanted ? wanted.includes(name) : existsSync(dir)))
      .map(([, dir]) => join(dir, "NativeMessagingHosts"))
const files = targets.map((dir) => join(dir, `${HOST}.json`))

if (process.argv.includes("--uninstall")) {
  for (const file of [...files, WRAPPER]) {
    rmSync(file, { force: true })
    console.log(`removed ${file}`)
  }
  process.exit(0)
}

await build()
const id = extensionId(EXT)
const bun = Bun.which("bun") ?? process.execPath
mkdirSync(STATE, { recursive: true })
const overrides = ["TRANSCRIPTS_PORT", "TRANSCRIPTS_EXT", "TRANSCRIPTS_STATE"]
  .filter((name) => process.env[name])
  .map((name) => `export ${name}=${quote(process.env[name]!)}\n`)
  .join("")
writeFileSync(WRAPPER, `#!/bin/sh\n${overrides}exec ${quote(bun)} ${quote(join(import.meta.dir, "host.ts"))} "$@"\n`)
chmodSync(WRAPPER, 0o755)
console.log(`wrote ${WRAPPER}`)

const manifest = {
  name: HOST,
  description: "Starts the local transcripts server for the Transcripts extension",
  path: WRAPPER,
  type: "stdio",
  allowed_origins: [`chrome-extension://${id}/`],
}
for (const file of files) {
  mkdirSync(join(file, ".."), { recursive: true })
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`)
  console.log(`wrote ${file}`)
}
console.log(`extension id ${id} (unpacked from ${EXT})`)
