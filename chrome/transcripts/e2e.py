# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.56.0"]
# ///
"""End-to-end check of the Transcripts extension against a live local server.

Run: uv run e2e.py [OUT_DIR]      (from chrome/transcripts; OUT_DIR defaults to ./evidence)

Copies ext/ to a temporary folder and runs on port 4599 with its own state
folder, so it leaves a running server on 4517 alone. Loads the copy as an
unpacked extension in headless Chromium, waits for the
extension to start the server through its native host, opens a fixture
transcript by path, appends records to it and waits for the page to show them.
Writes screenshots and result.json to OUT_DIR. Exit 1 on any failed check.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
EXT = HERE / "ext"
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "evidence").resolve()
PORT = int(os.environ.get("TRANSCRIPTS_E2E_PORT", "4599"))
BASE = f"http://127.0.0.1:{PORT}"
VAULT = OUT / "fixture" / "vault"
BROWSER = os.environ.get("BROWSER_PATH", "/Applications/Helium.app/Contents/MacOS/Helium")
results: list[dict] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("pass" if ok else "FAIL"), name, detail if not ok else "", flush=True)


def up() -> bool:
    try:
        urllib.request.urlopen(f"{BASE}/api/sessions", timeout=2).read()
        return True
    except OSError:
        return False


def stamp() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime()) + ".000Z"


def record(kind: str, uuid: str, content: object, **extra: object) -> str:
    role = "assistant" if kind == "assistant" else "user"
    rec = {"type": kind, "uuid": uuid, "timestamp": stamp(), "cwd": str(VAULT), "message": {"role": role, "content": content}, **extra}
    return json.dumps(rec) + "\n"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if up():
        print(f"a server already answers on 127.0.0.1:{PORT}. stop it first: this run checks that the extension starts one.")
        return 2
    work = pathlib.Path(os.path.realpath(tempfile.mkdtemp(prefix="transcripts-e2e-")))
    ext = work / "ext"
    shutil.copytree(EXT, ext, ignore=shutil.ignore_patterns("view.js", "chunks", "icon-*.png", "katex"))
    env = {**os.environ, "TRANSCRIPTS_PORT": str(PORT), "TRANSCRIPTS_EXT": str(ext), "TRANSCRIPTS_STATE": str(work / "state")}

    fixture = OUT / "fixture" / "live.jsonl"
    (VAULT / "sub").mkdir(parents=True, exist_ok=True)
    (VAULT / "docs").mkdir(exist_ok=True)
    (VAULT / "note-one.md").write_text(
        "---\nname: note-one\ndescription: a fixture note\nmetadata:\n  type: reference\n---\n\n# Note one\n\n"
        "The area is $\\pi r^2$. See [[second note#Details|the second note]].\n\n"
        "> [!note] remember\n> callouts keep their title.\n\n```python\nprint('hi')\n```\n"
    )
    (VAULT / "sub" / "second note.md").write_text("# Second note\n\nintro\n\n## Details\n\nthe details live here.\n")
    (VAULT / "docs" / "log.md").write_text("# The log\n\nan entry.\n")
    fixture.write_text(
        record("user", "u1", "count the markdown files, then report the total", origin={"kind": "human"})
        + record("assistant", "a1", [{"type": "text", "text": "*two commands answer this.*[^why] it costs $5 and $10, and $E = mc^2$ holds.\n\nsee [[note-one]], [[missing-note]] and [the log](docs/log.md).\n\n- list the files\n- count them with `wc -l`\n\n[^why]: `ls` lists the files.\n    A second line of the same note."}])
        + record("assistant", "a2", [{"type": "tool_use", "id": "toolu_1", "name": "Bash", "input": {"command": "ls *.md", "description": "List markdown files"}}])
    )

    with sync_playwright() as pw:
        profile = str(work / "profile")
        hosts = pathlib.Path(profile) / "NativeMessagingHosts"
        installed = subprocess.run(["bun", str(HERE / "server" / "install.ts"), "--dir", str(hosts)], capture_output=True, text=True, env=env)
        host = json.loads((hosts / "dev.aarnphm.transcripts.json").read_text()) if installed.returncode == 0 else {"allowed_origins": []}
        check("the installer writes the native host manifest", installed.returncode == 0, installed.stderr or installed.stdout)
        context = pw.chromium.launch_persistent_context(
            profile,
            executable_path=BROWSER,
            headless=True,
            ignore_default_args=["--disable-extensions"],
            args=[f"--load-extension={ext}", f"--disable-extensions-except={ext}"],
            viewport={"width": 1280, "height": 860},
        )
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=15000)
        ext_id = worker.url.split("/")[2]
        check("extension service worker started", worker.url.startswith("chrome-extension://"), worker.url)
        check("the installer computed the id chrome gave the unpacked extension", host["allowed_origins"] == [f"chrome-extension://{ext_id}/"], [host["allowed_origins"], ext_id])

        for _ in range(100):
            if up():
                break
            time.sleep(0.1)
        check("the extension started the server through the native host", up())
        request = urllib.request.Request(f"{BASE}/api/sessions", headers={"Origin": "https://example.com"})
        try:
            urllib.request.urlopen(request, timeout=2)
            check("a foreign web origin is refused", False, "request succeeded")
        except urllib.error.HTTPError as err:
            check("a foreign web origin is refused", err.code == 403, err.code)

        page = context.new_page()
        errors: list[str] = []
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(f"chrome-extension://{ext_id}/view.html")
        page.wait_for_function("() => document.getElementById('conn').dataset.state === 'online'", timeout=10000)
        check("extension page reaches the server", True)
        check("session list is filled from the local stores", page.locator(".sess").count() >= 1, page.inner_text("#conn"))

        page.fill("#find", str(fixture))
        page.press("#find", "Enter")
        page.wait_for_selector(".turn .prompt", timeout=5000)
        check("a transcript opens from its path", "count the markdown files" in page.inner_text(".prompt"), page.inner_text(".prompt"))
        check("markdown renders as elements", page.locator(".prose em").count() == 1 and page.locator(".prose > ul li code").count() == 1)
        note = page.evaluate("(() => { const p = document.querySelector('.prose'); return [p.querySelector('a[data-footnote-ref]')?.textContent, p.querySelectorAll('.footnotes li').length, p.querySelector('.footnotes li')?.textContent.replace(/\\s+/g, ' ').trim(), p.textContent.includes('[^why]')] })()")
        check("a footnote becomes a numbered reference and a note under the reply", note == ["1", 1, "ls lists the files. A second line of the same note. ↩", False], note)
        before = page.evaluate("location.hash")
        page.click("a[data-footnote-ref]")
        jumped = page.evaluate("[document.activeElement?.closest('.footnotes') !== null, location.hash]")
        page.click("a[data-footnote-backref]")
        check("the reference jumps to its note and back without leaving the session", jumped == [True, before] and page.evaluate("document.activeElement?.matches('a[data-footnote-ref]')"), jumped)
        maths = page.evaluate("[document.querySelectorAll('.turn .prose .katex').length, document.querySelector('.turn .prose').textContent.includes('$5 and $10')]")
        check("latex renders with katex and plain dollar amounts stay text", maths == [1, True], maths)

        page.click(".notelink[data-note='note-one']")
        page.wait_for_function("() => document.getElementById('side-title').textContent === 'Note one'", timeout=5000)
        shown = page.evaluate("(() => { const b = document.getElementById('side-body'); return [b.querySelectorAll('.props dt').length, b.querySelectorAll('.katex').length, b.querySelector('.callout-title')?.textContent, b.querySelectorAll('[class*=hljs-]').length > 0, b.querySelector('h3')?.textContent] })()")
        check("a wikilink opens the note in the side panel with properties, math, a callout and code colour", shown == [3, 1, "remember", True, None], shown)
        page.screenshot(path=str(OUT / "11-note-panel.png"))
        page.click("#side-body .notelink")
        page.wait_for_function("() => document.getElementById('side-title').textContent === 'Second note'", timeout=5000)
        page.click("#side-back")
        page.wait_for_function("() => document.getElementById('side-title').textContent === 'Note one'", timeout=5000)
        check("a wikilink inside a note is found by name in a subfolder, and back returns", True)
        page.click(".turn .notelink[data-note='docs/log.md']")
        page.wait_for_function("() => document.getElementById('side-title').textContent === 'The log'", timeout=5000)
        page.click(".turn .notelink[data-note='missing-note']")
        page.wait_for_function("() => /no note named/.test(document.getElementById('side-body').textContent)", timeout=5000)
        check("a link to a markdown file opens too, and a missing note says where it looked", "missing-note.md" in page.inner_text("#side-body"), page.inner_text("#side-body"))
        page.keyboard.press("Escape")
        check("escape closes the side panel", page.locator("#side").is_hidden())
        check("a pending step shows as running", page.locator(".node .flag[data-flag=run]").count() == 1)
        page.screenshot(path=str(OUT / "01-opened-light.png"))

        with fixture.open("a") as f:
            f.write(record("user", "r1", [{"type": "tool_result", "tool_use_id": "toolu_1", "content": "\x1b[1ma.md\x1b[22m\n\x1b[31mb.md\x1b[0m\nc.md"}]))
            f.write(record("assistant", "a3", [{"type": "tool_use", "id": "toolu_2", "name": "Bash", "input": {"command": "ls *.md | wc -l", "description": "Count them"}}]))
        page.wait_for_function("() => document.querySelectorAll('.run .node').length === 2 || /2 steps/.test(document.querySelector('.run-head')?.textContent ?? '')", timeout=6000)
        check("appended records arrive without a reload", "2 steps" in page.inner_text(".run-head"), page.inner_text(".run-head"))
        check("the collapsed group names the running step", "running" in page.inner_text(".run-head"), page.inner_text(".run-head"))

        with fixture.open("a") as f:
            f.write(record("user", "r2", [{"type": "tool_result", "tool_use_id": "toolu_2", "content": "zsh: no matches found: *.md", "is_error": True}]))
            f.write(record("assistant", "a4", [{"type": "text", "text": "## result\n\nthe glob matched nothing."}]))
            f.write(record("user", "u2", "try again in docs/", origin={"kind": "human"}))
        page.wait_for_function("() => document.querySelectorAll('.turn').length === 2", timeout=6000)
        check("a failed step is counted in the group", "1 failed" in page.inner_text(".run-head"), page.inner_text(".run-head"))
        check("a new prompt starts a second turn", page.locator(".turn").count() == 2)

        page.click(".run-head")
        check("the group opens into a tree of steps", page.locator(".run[data-open] .node").count() == 2)
        page.click(".run[data-open] .node:first-child button.step-head")
        listing = page.locator(".run[data-open] .node:first-child .step-body")
        styled = listing.locator(".a-bold").inner_text() == "a.md" and listing.locator(".a-fg1").inner_text() == "b.md"
        check("terminal escapes become styles, not text", styled and "[1m" not in listing.inner_text(), listing.inner_text())
        page.click(".node:has(.flag[data-flag=err]) button.step-head")
        body = page.inner_text(".node:has(.flag[data-flag=err]) .step-body")
        check("a step opens to its command and error", "ls *.md | wc -l" in body and "no matches found" in body, body)
        page.screenshot(path=str(OUT / "02-live-tree-light.png"))

        page.click(".run-head")
        page.keyboard.press("/")
        page.wait_for_selector("#seek-q:focus", timeout=3000)

        def sums(text: str) -> None:
            page.wait_for_function("want => document.querySelector('.seek-sum').textContent === want", arg=text, timeout=5000)

        page.fill("#seek-q", '"matches found"')
        sums("1 match in 1 item")
        page.press("#seek-q", "Enter")
        page.wait_for_function("() => CSS.highlights.has('find')", timeout=3000)
        marked = page.evaluate("(() => { const r = [...CSS.highlights.get('find') ?? []]; return [r.length, r[0]?.toString(), !!r[0]?.startContainer.parentElement.closest('.run[data-open]')] })()")
        check("search in the side panel opens the folded step that holds the match and marks it", marked == [1, "matches found", True], marked)
        page.screenshot(path=str(OUT / "07-search.png"))

        page.fill("#seek-q", "DOCS try")
        sums("no matches")
        page.fill("#seek-q", "docs try")
        sums("1 match in 1 item")
        check("terms match in any order, and capitals make a term exact", True)
        page.click(".seek [data-flag=regex]")
        page.fill("#seek-q", "^[ac]\\.md$")
        sums("2 matches in 1 item")
        page.fill("#seek-q", "(")
        page.wait_for_function("() => document.querySelector('.seek-sum').textContent.startsWith('not a valid regular expression')", timeout=5000)
        check("the regex flag matches by pattern and a bad pattern is explained", True)
        page.click(".seek [data-flag=fuzzy]")
        page.fill("#seek-q", "glbmtch")
        page.wait_for_function("() => document.querySelector('.seek-line .tx')?.textContent.includes('glob matched')", timeout=5000)
        check("the fuzzy flag finds letters in order with gaps", page.get_attribute(".seek [data-flag=regex]", "aria-pressed") == "false")
        page.click(".seek [data-flag=fuzzy]")
        page.fill("#seek-q", "md")
        page.fill("#seek-filter", "reply")
        page.wait_for_function("() => { const w = [...document.querySelectorAll('.seek-file .where')]; return w.length > 0 && w.every(e => e.textContent.endsWith('reply')) }", timeout=5000)
        page.fill("#seek-filter", "-reply -prompt")
        page.wait_for_function("() => { const w = [...document.querySelectorAll('.seek-file .where')]; return w.length > 0 && w.every(e => !/reply|prompt/.test(e.textContent)) }", timeout=5000)
        check("the filter keeps or drops kinds of item", True)
        page.fill("#seek-filter", "")

        page.press("#seek-q", "Escape")
        for _ in range(8):
            page.keyboard.press("]")
            if page.locator(".run.picked").count():
                break
        page.keyboard.press("/")
        page.fill("#seek-q", "md")
        page.wait_for_function("() => { const w = [...document.querySelectorAll('.seek-file .where')]; return w.length > 0 && w.every(e => e.textContent.endsWith('bash')) }", timeout=5000)
        scope = page.evaluate("[document.querySelector('.seek [data-scope=block]').getAttribute('aria-pressed'), document.querySelector('.seek-where').textContent, document.getElementById('side-sub').textContent]")
        check("a block picked with ] narrows the search to its steps", scope == ["true", "turn 1 · 2 steps", "in turn 1 · 2 steps"], scope)
        page.screenshot(path=str(OUT / "16-search-block.png"))
        page.click(".seek [data-scope=all]")
        page.fill("#seek-q", "glob matched nothing")
        page.wait_for_function("() => /^\\d+ match(es)? in \\d+ sessions?$/.test(document.querySelector('.seek-sum').textContent)", timeout=10000)
        check("the all sessions scope lists sessions with their lines", page.locator(".seek-group").count() >= 1, page.inner_text(".seek-sum"))
        page.press("#seek-q", "Escape")
        page.keyboard.press("Escape")
        cleared = page.locator(".picked").count() == 0 and page.locator("#side").is_visible()
        page.keyboard.press("Escape")
        check("escape clears the selection, then closes the panel and the marks", cleared and page.locator("#side").is_hidden() and page.evaluate("!CSS.highlights.has('find')"))

        page.set_viewport_size({"width": 1280, "height": 420})
        page.evaluate("document.getElementById('scroll').scrollTop = 0")
        page.focus("#scroll")
        tops = []
        for keys in (["j"], ["3", "j"], ["G"], ["g", "g"], ["d"]):
            for key in keys:
                page.keyboard.press(key)
            tops.append(page.evaluate("Math.round(document.getElementById('scroll').scrollTop)"))
        half = page.evaluate("Math.round(document.getElementById('scroll').clientHeight / 2)")
        check("vim keys scroll: j, a count, G, gg and d", tops[0] == 48 and tops[1] == 192 and tops[2] > 192 and tops[3] == 0 and tops[4] == half, [tops, half])
        page.set_viewport_size({"width": 1280, "height": 860})

        page.fill("#find", "glob matched nothing")
        page.wait_for_function("() => /with matches/.test(document.getElementById('conn').textContent)", timeout=8000)
        check("the rail filter searches what was said, not only titles", True, page.inner_text("#conn"))
        page.fill("#find", "")

        bars = page.evaluate("[...document.querySelectorAll('.toc-item')].map(b => b.dataset.depth).join('')")
        check("the rail has one bar per turn and a short bar per heading", bars == "010", bars)
        page.set_viewport_size({"width": 1280, "height": 420})
        page.evaluate("document.getElementById('scroll').scrollTop = 1e6")
        page.hover(".toc-item >> nth=0")
        page.wait_for_function("() => document.querySelector('.toc-label.is-visible')?.textContent.includes('count the markdown files')", timeout=3000)
        wide = page.evaluate("document.querySelector('.toc-item .fill').getBoundingClientRect().width > 60")
        check("hovering the rail widens the bars and names the turn", wide and page.locator(".stage.toc-hovering").count() == 1)
        page.screenshot(path=str(OUT / "08-toc.png"))
        page.click(".toc-item >> nth=0")
        page.wait_for_function("() => document.getElementById('scroll').scrollTop < 20", timeout=4000)
        check("a click on a bar scrolls to its turn", page.locator(".toc.is-hovering").count() == 0)
        page.mouse.move(700, 300)
        page.set_viewport_size({"width": 1280, "height": 860})

        page.emulate_media(color_scheme="dark")
        page.screenshot(path=str(OUT / "03-live-tree-dark.png"))
        check("dark theme paints the dark ground", page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(16, 15, 15)")
        page.emulate_media(color_scheme="light")

        page.set_viewport_size({"width": 320, "height": 700})
        page.wait_for_timeout(200)
        widths = page.evaluate("[document.documentElement.scrollWidth, innerWidth]")
        check("no sideways scroll at 320px", widths[0] <= widths[1], widths)
        page.screenshot(path=str(OUT / "04-phone-320.png"))
        page.set_viewport_size({"width": 1280, "height": 860})

        page.focus("#find")
        page.keyboard.press("Tab")
        ring = page.evaluate("(() => { const el = document.activeElement, s = getComputedStyle(el); return [el.tagName, s.outlineStyle, s.outlineWidth] })()")
        check("keyboard focus draws a 2px ring", ring == ["BUTTON", "solid", "2px"], ring)

        page.keyboard.press("Escape")
        page.locator("body").press("?")
        rows = page.locator("#keys:popover-open dl div").count()
        check("? opens one page with every shortcut", rows == 13, rows)
        page.wait_for_timeout(300)
        solid = page.evaluate("(() => { const s = getComputedStyle(document.getElementById('keys')); return [s.opacity, s.backgroundColor] })()")
        check("the shortcuts page is opaque paper", solid == ["1", "rgb(255, 252, 240)"], solid)
        page.screenshot(path=str(OUT / "06-shortcuts.png"))
        page.keyboard.press("Escape")
        check("escape closes the shortcuts page", page.locator("#keys:popover-open").count() == 0)
        bar = page.evaluate("getComputedStyle(document.getElementById('sessions'), '::-webkit-scrollbar').width")
        check("scrollbars are 8px and styled by the page", bar == "8px", bar)

        places = "['copy', 'theme'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [r.left, r.width] })"
        still = page.evaluate(places)
        page.click("#copy")
        page.wait_for_function("() => document.getElementById('copy').textContent !== 'copy id'", timeout=3000)
        check("copy id keeps every control in place", page.evaluate(places) == still, [still, page.evaluate(places)])

        agents = fixture.with_suffix("") / "subagents"
        agents.mkdir(parents=True, exist_ok=True)
        (agents / "agent-abc123.meta.json").write_text(json.dumps({"agentType": "general-purpose", "toolUseId": "toolu_agent"}))
        (agents / "agent-abc123.jsonl").write_text(record("user", "s1", "count files under docs/") + record("assistant", "s2", [{"type": "text", "text": "looking in docs/."}]))
        with fixture.open("a") as f:
            f.write(record("assistant", "a5", [{"type": "tool_use", "id": "toolu_agent", "name": "Agent", "input": {"description": "Count files in docs", "prompt": "count files under docs/", "subagent_type": "general-purpose"}}]))
            f.write(record("user", "r3", [{"type": "tool_result", "tool_use_id": "toolu_agent", "content": "3 files"}], toolUseResult={"agentId": "abc123"}))
        page.wait_for_selector(".turn:nth-child(2) .node[data-k=tool]", timeout=6000)
        page.click(".turn:nth-child(2) .node button.step-head")
        page.click(".agent-open")
        page.wait_for_function("() => document.querySelector('#side-body .prompt')?.textContent.includes('count files under docs/')", timeout=5000)
        with (agents / "agent-abc123.jsonl").open("a") as f:
            f.write(record("assistant", "s3", [{"type": "text", "text": "found 3 files."}]))
        page.wait_for_function("() => document.getElementById('side-body').textContent.includes('found 3 files.')", timeout=6000)
        check("a subagent transcript opens in the side panel and follows new records", page.inner_text("#side-title") == "Count files in docs", page.inner_text("#side-title"))
        page.screenshot(path=str(OUT / "12-subagent-panel.png"))
        page.keyboard.press("Escape")

        # Open an older-style structured edit in its own transcript.
        edit = OUT / "fixture" / "edit.jsonl"
        file = str(VAULT / "code sample.ts")
        long_value = "x" * 160
        edit.write_text(
            record("user", "du", "update the count", origin={"kind": "human"})
            + record("assistant", "da", [{"type": "tool_use", "id": "toolu_edit", "name": "Edit", "input": {"file_path": file}}])
            + record(
                "user", "dr", [{"type": "tool_result", "tool_use_id": "toolu_edit", "content": "updated"}],
                toolUseResult={"filePath": file, "structuredPatch": [
                    {"oldStart": 37, "newStart": 37, "lines": ["-const count = 1", "+const count = 2", " // retained context"]},
                    {"oldStart": 91, "newStart": 91, "lines": [f'+const text = "<script>{long_value}</script>"']},
                ]},
            )
        )
        # The literal script is source text in the patch, including its angle brackets.
        page.goto(f"chrome-extension://{ext_id}/view.html#q=" + urllib.parse.quote(str(edit), safe=""))
        page.wait_for_selector('[data-id="toolu_edit"] > .step-head', timeout=6000)
        page.keyboard.press("ControlOrMeta+f")
        page.locator('.seek [data-scope="session"]').click()
        page.fill("#seek-q", "retained")
        page.locator(".seek-line").filter(has_text="retained").click(timeout=6000)
        page.wait_for_function("""() => [...CSS.highlights.get('find') ?? []].some(
            r => r.startContainer.parentElement.closest('[data-id="toolu_edit"] .diff code') && r.toString() === 'retained'
        )""", timeout=6000)
        check("search opens a recorded edit and marks its syntax-highlighted code", True)
        page.keyboard.press("Escape")
        patch_view = page.locator('[data-id="toolu_edit"] .diff')
        added = patch_view.locator('[data-line-type="change-addition"]').first
        removed = patch_view.locator('[data-line-type="change-deletion"]')
        added.wait_for(timeout=8000)
        check(
            "Pierre renders the recorded hunk positions and explicit add and remove markers",
            added.locator(".diff-number").inner_text() == "37"
            and removed.locator(".diff-sign").inner_text() == "−"
            and added.locator(".diff-sign").inner_text() == "+"
            and patch_view.locator('[data-line="91"] code').inner_text().endswith(f'{long_value}</script>"'),
        )
        token = added.locator("code span").first
        light_token = token.evaluate("(el) => getComputedStyle(el).color")
        check(
            "TypeScript tokens are highlighted and markup in source stays text",
            light_token != added.locator("code").evaluate("(el) => getComputedStyle(el).color")
            and patch_view.locator("script").count() == 0,
            light_token,
        )
        patch_block = page.locator('[data-id="toolu_edit"] .blk').filter(has=page.locator(".diff"))
        patch_block.screenshot(path=str(OUT / "13-diff-light.png"))
        page.emulate_media(color_scheme="dark")
        dark_token = token.evaluate("(el) => getComputedStyle(el).color")
        check("diff code follows the dark Garden palette", dark_token != light_token, [light_token, dark_token])
        patch_block.screenshot(path=str(OUT / "14-diff-dark.png"))
        page.set_viewport_size({"width": 320, "height": 700})
        diff_width = patch_view.evaluate("(el) => [el.scrollWidth, el.clientWidth, document.documentElement.scrollWidth, innerWidth]")
        check("long diff lines wrap inside the 320px viewport", diff_width[0] <= diff_width[1] and diff_width[2] <= diff_width[3], diff_width)
        patch_block.screenshot(path=str(OUT / "15-diff-phone.png"))
        page.emulate_media(color_scheme="light")
        page.set_viewport_size({"width": 1280, "height": 860})

        pages = len(context.pages)
        worker.evaluate("id => show('#q=' + encodeURIComponent(id))", "live.jsonl-missing")
        page.wait_for_function("() => /nothing to open/.test(document.getElementById('state').textContent)", timeout=8000)
        check("the omnibox handler reuses the open tab", len(context.pages) == pages, len(context.pages))
        check("an unknown id says what it looked for", "live.jsonl-missing" in page.inner_text("#state"), page.inner_text("#state"))
        page.screenshot(path=str(OUT / "05-unknown-id.png"))

        check("no console errors on the page", not errors, errors)
        page.close()
        stopped = worker.evaluate("chrome.runtime.sendNativeMessage('dev.aarnphm.transcripts', { cmd: 'stop' })")
        check("the native host stops the server", stopped.get("stopped") is True and not up(), stopped)
        context.close()

    shutil.rmtree(work, ignore_errors=True)
    failed = [r for r in results if not r["ok"]]
    (OUT / "result.json").write_text(json.dumps({"ran": stamp(), "browser": BROWSER, "passed": len(results) - len(failed), "failed": len(failed), "checks": results}, indent=2) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
