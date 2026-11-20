# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.56.0"]
# ///
"""End-to-end check of the Copy URL extension.

Run: uv run e2e.py [OUT_DIR]      (from chrome/copy-url; OUT_DIR defaults to ./evidence)

Loads this folder as an unpacked extension in headless Chromium, opens three
local pages, selects tabs the way a shift-click does, and runs the extension's
copy for one tab, for three tabs as a Markdown list, and for three tabs as
space-separated URLs (the ctrl shift c command; Karabiner maps ctrl option c to it). Each result is read back from the clipboard. The macOS
clipboard is saved first and put back at the end. Writes result.json and a
screenshot to OUT_DIR. Exit 1 on any failed check.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else HERE / "evidence").resolve()
BROWSER = os.environ.get("BROWSER_PATH", "/Applications/Helium.app/Contents/MacOS/Helium")
PAGES = {"/alpha": "Alpha", "/notes (draft)": "Plan [draft] \\ v2", "/gamma": ""}
results: list[dict] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    results.append({"check": name, "ok": bool(ok), "detail": detail})
    print("pass" if ok else "FAIL", name, "" if ok else detail, flush=True)


class Pages(BaseHTTPRequestHandler):
    def do_GET(self):
        title = PAGES.get(unquote(self.path), "")
        body = f"<!doctype html><title>{title}</title><p>{unquote(self.path)}</p>".encode()
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args):
        pass


def clipboard() -> str | None:
    if not shutil.which("pbpaste"):
        return None
    return subprocess.run(["pbpaste"], capture_output=True, text=True).stdout


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    saved = clipboard()
    server = ThreadingHTTPServer(("127.0.0.1", 0), Pages)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    work = pathlib.Path(tempfile.mkdtemp(prefix="copy-url-e2e-"))
    ext = work / "ext"
    shutil.copytree(HERE, ext, ignore=shutil.ignore_patterns("e2e.py", "install.sh", "evidence", "index.md"))

    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            str(work / "profile"),
            executable_path=BROWSER,
            headless=True,
            ignore_default_args=["--disable-extensions"],
            args=[f"--load-extension={ext}", f"--disable-extensions-except={ext}"],
            viewport={"width": 900, "height": 600},
        )
        context.grant_permissions(["clipboard-read", "clipboard-write"], origin=base)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event("serviceworker", timeout=15000)

        shortcuts = {c["name"]: c["shortcut"] for c in worker.evaluate("chrome.commands.getAll()")}
        check("the extension loads and ctrl shift c is bound to the plain copy", shortcuts.get("copy-url-plain") == "⌃⇧C", shortcuts)

        warm = context.pages[0] if context.pages else context.new_page()
        warm.wait_for_timeout(5000)
        tabs = [context.new_page() for _ in PAGES]
        for page, path in zip(tabs, PAGES):
            for attempt in range(3):
                try:
                    page.goto(base + path)
                    break
                except Exception:
                    if attempt == 2:
                        raise
                    page.wait_for_timeout(1000)
        reader = tabs[0]

        def read() -> str:
            reader.bring_to_front()
            return reader.evaluate("navigator.clipboard.readText()")

        def select(paths: list[str]) -> dict:
            urls = [base + p for p in paths]
            return worker.evaluate(
                """async (urls) => {
                  const all = await chrome.tabs.query({})
                  const picked = urls.map(u => all.find(t => decodeURI(t.url) === u))
                  await chrome.tabs.highlight({ windowId: picked[0].windowId, tabs: picked.map(t => t.index) })
                  return (await chrome.tabs.get(picked[0].id))
                }""",
                urls,
            )

        one = select(["/alpha"])
        text = worker.evaluate("tab => copyUrls(tab, 'markdown')", one)
        check("one tab copies its plain url", text == f"{base}/alpha" and read() == text, text)

        first = select(list(PAGES))
        text = worker.evaluate("tab => copyUrls(tab, 'markdown')", first)
        want = "\n".join([
            f"- [Alpha]({base}/alpha)",
            f"- [Plan \\[draft\\] \\\\ v2]({base}/notes%20%28draft%29)",
            f"- [{base.removeprefix('http://')}/gamma]({base}/gamma)",
        ])
        check("three selected tabs copy as a markdown list in tab order", text == want, text)
        check("the clipboard holds the markdown list", read() == want, read())

        first = select(list(PAGES))
        text = worker.evaluate("tab => copyUrls(tab, 'plain')", first)
        want = " ".join([f"{base}/alpha", f"{base}/notes%20(draft)", f"{base}/gamma"])
        check("the plain copy gives the urls separated by spaces", text == want and read() == want, text)

        badge = worker.evaluate("tab => chrome.action.getBadgeText({ tabId: tab.id })", first)
        check("the badge shows how many tabs were copied", badge == "3", badge)

        def menu() -> dict:
            worker.evaluate("new Promise(r => setTimeout(r, 300))")
            return worker.evaluate("menu")

        select(list(PAGES))
        shown = menu()
        check("with three tabs selected the right-click menu offers Copy 3 tabs", shown == {"title": "Copy 3 tabs", "visible": True}, shown)
        two = select(list(PAGES)[:2])
        shown = menu()
        check("the entry follows the selection: two tabs says Copy 2 tabs", shown == {"title": "Copy 2 tabs", "visible": True}, shown)
        text = worker.evaluate("tab => onMenuClick({ menuItemId: 'copy-tabs' }, tab)", two)
        check("choosing the entry copies the selected tabs as a markdown list", text is not None and text.count("\n") == 1 and read() == text, text)
        select(["/alpha"])
        shown = menu()
        check("with one tab selected the entry is hidden", shown["visible"] is False, shown)

        (OUT / "copied-markdown.txt").write_text(worker.evaluate("tab => copyUrls(tab, 'markdown')", select(list(PAGES))) + "\n")
        (OUT / "copied-plain.txt").write_text(worker.evaluate("tab => copyUrls(tab, 'plain')", select(list(PAGES))) + "\n")
        context.close()

    server.shutdown()
    shutil.rmtree(work, ignore_errors=True)
    after = clipboard()
    if saved is not None and after != saved:
        subprocess.run(["pbcopy"], input=saved, text=True)
    check("the mac clipboard is left as it was", saved is None or after == saved or clipboard() == saved, "restored" if after != saved else "untouched")
    failed = [r for r in results if not r["ok"]]
    stamp = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    (OUT / "result.json").write_text(json.dumps({"ran": stamp, "browser": BROWSER, "passed": len(results) - len(failed), "failed": len(failed), "checks": results}, indent=2) + "\n")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
