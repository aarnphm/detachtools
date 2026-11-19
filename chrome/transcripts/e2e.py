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
import urllib.request

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
EXT = HERE / "ext"
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "evidence").resolve()
PORT = 4599
BASE = f"http://127.0.0.1:{PORT}"
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
    rec = {"type": kind, "uuid": uuid, "timestamp": stamp(), "cwd": "/tmp/demo", "message": {"role": role, "content": content}, **extra}
    return json.dumps(rec) + "\n"


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    if up():
        print(f"a server already answers on 127.0.0.1:{PORT}. stop it first: this run checks that the extension starts one.")
        return 2
    work = pathlib.Path(os.path.realpath(tempfile.mkdtemp(prefix="transcripts-e2e-")))
    ext = work / "ext"
    shutil.copytree(EXT, ext, ignore=shutil.ignore_patterns("view.js", "icon-*.png"))
    env = {**os.environ, "TRANSCRIPTS_PORT": str(PORT), "TRANSCRIPTS_EXT": str(ext), "TRANSCRIPTS_STATE": str(work / "state")}

    fixture = OUT / "fixture" / "live.jsonl"
    fixture.parent.mkdir(exist_ok=True)
    fixture.write_text(
        record("user", "u1", "count the markdown files, then report the total", origin={"kind": "human"})
        + record("assistant", "a1", [{"type": "text", "text": "*two commands answer this.*\n\n- list the files\n- count them with `wc -l`"}])
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
        check("markdown renders as elements", page.locator(".prose em").count() == 1 and page.locator(".prose li code").count() == 1)
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
        page.keyboard.press("ControlOrMeta+f")
        page.fill("#find-in", '"matches found"')
        page.wait_for_function("() => document.getElementById('find-count').textContent === '1 / 1'", timeout=5000)
        marked = page.evaluate("(() => { const r = [...CSS.highlights.get('find') ?? []]; return [r.length, r[0]?.toString(), !!r[0]?.startContainer.parentElement.closest('.run[data-open]')] })()")
        check("find opens the folded step that holds the match and marks it", marked == [1, "matches found", True], marked)
        page.screenshot(path=str(OUT / "07-find.png"))
        page.fill("#find-in", "DOCS try")
        page.wait_for_function("() => document.getElementById('find-count').textContent === 'no matches'", timeout=5000)
        page.fill("#find-in", "docs try")
        page.wait_for_function("() => document.getElementById('find-count').textContent === '1 / 1'", timeout=5000)
        check("terms match in any order, and capitals make a term exact", True)
        page.keyboard.press("Escape")
        check("escape closes find and clears the marks", page.locator("#finder").is_hidden() and page.evaluate("!CSS.highlights.has('find')"))

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
        check("? opens one page with every shortcut", rows == 9, rows)
        page.wait_for_timeout(300)
        solid = page.evaluate("(() => { const s = getComputedStyle(document.getElementById('keys')); return [s.opacity, s.backgroundColor] })()")
        check("the shortcuts page is opaque paper", solid == ["1", "rgb(255, 252, 240)"], solid)
        page.screenshot(path=str(OUT / "06-shortcuts.png"))
        page.keyboard.press("Escape")
        check("escape closes the shortcuts page", page.locator("#keys:popover-open").count() == 0)
        bar = page.evaluate("getComputedStyle(document.getElementById('sessions'), '::-webkit-scrollbar').width")
        check("scrollbars are 8px and styled by the page", bar == "8px", bar)

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
