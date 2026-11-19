---
name: transcripts
description: Chrome extension plus local bun server that renders Claude Code, Argon (agy) and Codex transcripts as a live tree of turns and collapsed tool steps; Garden look; port 4517
metadata:
  type: reference
type: tooling
kind: index
status: current
basis: observed
author: claude
session: bdecb69b-c4ca-4862-90bb-8dd5edb7635b
created: 2026-11-19
---

# Transcripts

A reader for agent sessions on this machine. A bun server reads the stores and tails them. The extension page draws each session: one block per prompt, prose as markdown, and each group of tool calls folded into one row that opens into a tree.

## Run it

1. Register the native host once. It installs the page's packages with `pnpm install --frozen-lockfile` when `node_modules` is missing, builds `ext/view.js`, the icons and the KaTeX files, writes the launcher `~/.local/state/transcripts/native-host`, and writes `dev.aarnphm.transcripts.json` into the `NativeMessagingHosts` folder of each browser.

   ```bash
   bun server/install.ts --browsers chrome,helium
   ```

2. Load `ext/` in Chrome or Helium: `chrome://extensions`, developer mode, "Load unpacked".
3. Click the toolbar button, or type `tr`, a space, then a session id or a transcript path in the address bar.

The extension starts the server. The same page is served at `http://127.0.0.1:4517/` for a browser without the extension.

## The daemon

An extension cannot start a process. Chrome can: it runs a registered native host when the extension sends it a message. The host is `server/host.ts`.

- The extension sends `{cmd: "start"}` when the browser starts, when the extension is installed or reloaded, when the toolbar button is clicked, and when the page finds no server.
- `start` asks `GET /api/health`. With no answer it starts `server/main.ts` in its own session, with output in `~/.local/state/transcripts/server.log`, and waits up to 8 s for the port. A lock folder stops two hosts from starting two servers.
- The server keeps running after the browser quits. `{cmd: "stop"}` ends it; so does `pkill -f transcripts/server/main.ts`.
- The manifest allows one extension id. An unpacked extension gets its id from the path of its folder, and the installer computes it from `ext/`. Run the installer again after you move the repo.
- With no flag the installer writes to every Chromium browser that has a profile folder here. `--uninstall` removes the files. `--dir <folder>` writes to one folder (the test uses it).

`?` opens the one page that lists every shortcut.

To run the server by hand: `bun server/main.ts`. `--watch` rebuilds the page when a file in `ui/` changes. `TRANSCRIPTS_PORT` moves the server, but the extension expects 4517.

## What it reads

| source | store | format |
| --- | --- | --- |
| claude | `~/.claude/projects/*/<id>.jsonl`, subagents in `<id>/subagents/` | JSONL, one record per content block |
| argon | `~/.gemini/antigravity-cli/conversations/<id>.db` | SQLite `steps` table, protobuf payloads, decoded without a schema in `server/argon.ts` |
| codex | `~/.codex/sessions/**/rollout-*-<id>.jsonl` | JSONL, `item_completed` events |

A path to any `.jsonl` or `.db` transcript opens the same way as an id. Ids match from their first four characters.

## Live updates

- `GET /api/stream/<source>/<id>` is a server-sent event stream: one `snapshot`, then `upsert` for each new or changed item. The server watches the file and also checks it every 2 s.
- `GET /api/sessions/stream` sends the session list, then one delta for each new or changed session.
- `POST /api/notify` makes the server scan and tail now. Call it from a hook when 2 s is too slow.

The server refuses a request whose `Host` is not `127.0.0.1:4517` or `localhost:4517`, and a request from a web origin other than itself or a `chrome-extension://` page.

## Markdown

Replies and notes go through one remark and rehype pipeline in `ui/render.ts`: GFM (tables, task lists, strikethrough, footnotes), math with KaTeX, code colour with highlight.js, and the Obsidian forms `[[wikilink]]`, `[[note#heading|alias]]`, `==highlight==`, `%%comment%%` and `> [!note]` callouts. The tree becomes DOM nodes with `hast-util-to-dom`; nothing is set through `innerHTML`.

- Math: `$x$`, `$$x$$`, `\(x\)` and `\[x\]`. A `$` that does not open or close math by pandoc's rules (`$5 and $10`) is kept as text.
- Raw HTML in a reply is shown as its source text. A remote image is shown as its alt text and is not fetched.
- Rendering the largest session here (250 replies, 120,000 characters) takes 106 ms.

## The side panel

A wikilink, or a link to a `.md` file, opens that note in a panel on the right. The server finds the file (`GET /api/note`): a path is tried against the note that holds the link, the session's directory and the vault; a bare name is matched by file name anywhere in the vault, then in the Claude memory folder of that directory. The vault is the nearest parent folder with `.obsidian`. Only `.md` files under the home folder are read, up to 2 MB.

The panel shows the frontmatter as a table, then the note. Links inside it open in the same panel and `back` returns. An `agent` step has `open the subagent transcript`, which shows that transcript in the panel and follows it while the subagent runs. `esc` closes the panel.

## The rail of bars

The left edge of the transcript has the table of contents from aarnphm.xyz (`quartz/components/TableOfContents.tsx`, minimal layout), ported in `ui/toc.ts`. It has one bar for each turn and a half-width bar for each heading in a reply. Bars for what is on screen are darker. Under the pointer the bars widen, one label names the nearest turn, and the page behind is veiled. A click scrolls to that turn. The rail is hidden when the pane is narrower than 56rem and on a device with no hover; `j` and `k` do the same job from the keyboard.

## Search

- `⌘F` (or `ctrl F`) opens find for the open session. The server searches the parsed items in memory, so a match inside a folded group or a clamped output is found; the page then opens that step, scrolls to it and marks the text. `enter` and `shift enter` step through; `⌘G` does the same.
- A query is a list of terms. Every term must occur in the same item, in any order. A term with a capital letter is matched with its case; `"two words"` in quotes is one term.
- The rail filter searches titles at once and, from three characters, what was said. `rg` lists the session files that contain every term, then the server parses only those and counts the items that match. A row with matches shows the count and one line of context, and opens with find filled in.
- `GET /api/search/<source>/<id>?q=` returns the items that match in one session. `GET /api/search?q=` returns the sessions that match, newest first, from at most 80 candidates.
- The daemon gets the path of `rg` from `TRANSCRIPTS_RG`, which the installer writes into the launcher, because Chrome starts it with a bare `PATH`. With no `rg` the server parses every session instead.

## Files

| path | holds |
| --- | --- |
| `server/main.ts` | routes, event streams, session scan, origin check |
| `server/claude.ts`, `codex.ts`, `argon.ts` | one adapter per store; each turns records into the items in `server/types.ts` |
| `server/pb.ts` | protobuf wire decoder for the Argon steps |
| `server/notes.ts` | finds a note by path or by name in the vault |
| `server/search.ts` | query terms, item text, the `rg` file filter and a parsed-session cache |
| `server/build.ts` | bundles `ui/` and draws the icons |
| `server/host.ts`, `install.ts` | the native host (`start`, `stop`, `status`) and the script that registers it |
| `ui/` | the page: `render.ts` (the remark and rehype pipeline), `panel.ts` (the side panel for notes and subagent transcripts), `ansi.ts` (terminal escapes to styled spans), `find.ts` (find bar, reveal and marks), `toc.ts` (the rail of bars), `transcript.ts` (turns, groups, step tree), `main.ts` (list, routing, keys) |
| `ext/` | the unpacked extension; `view.js`, `icon-*.png` and `katex/` are build output |
| `package.json`, `pnpm-lock.yaml` | the page's pinned packages (unified, remark, rehype, katex) |
| `e2e.py` | headless check of the extension against a fixture transcript that grows during the run |

## Check it

```bash
uv run e2e.py
```

The run copies `ext/` to a temporary folder and uses port 4599 with its own state folder (`TRANSCRIPTS_PORT`, `TRANSCRIPTS_EXT`, `TRANSCRIPTS_STATE`), so a server on 4517 keeps running. It registers the host inside a temporary browser profile, loads the copy in headless Helium (`BROWSER_PATH` picks another Chromium), and waits for the extension to start the server. It then opens a fixture by path, appends records, waits for the page to show them, and stops the server through the host. It writes screenshots and `result.json` to `evidence/`, or to the folder given as the first argument. The run on 2026-11-19 passed 44 of 44 checks; its record is in `~/workspace/output/transcripts-viewer/`.

## Known limits

- A code block is coloured only when its fence names a language.
- The side panel reads markdown only. A link to a code file stays inert.
- An embed (`![[note]]`) is a link to the note; the note is not drawn in place.
- Terminal output keeps bold, dim, italic, underline, strike, inverse and the 16 basic colours. 256-colour and true-colour text keeps the default ink, and background colours are dropped, so text stays readable on paper.
- Claude thinking blocks are stored empty in most sessions, so they do not show. Argon and Codex reasoning shows when the store has its text.
- A footnote is matched to its definition inside one reply block. A reference whose definition is in another block stays as written.
- With `node_modules` missing the page cannot be built. The server then serves the last build, or fails to start when there is none; run the installer.
- Search does not read subagent transcripts. A mark does not span markup, so a phrase that crosses bold or a link is found but not marked.
- An Argon step type other than 14, 15, 101 or 132 shows as a `system` row with its longest string.
- The host files are written by `install.ts`, outside nix. A home-manager module in `hm/` would make them part of a rebuild.
- Nothing stops the server when it is idle.
