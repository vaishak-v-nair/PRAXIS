"""Inspect the built public entry points at desktop and mobile sizes."""

import functools
import json
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from playwright.sync_api import sync_playwright


ROOT = Path(__file__).resolve().parents[3]
ARTIFACTS = ROOT / "apps/workbench/.regen/artifacts"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def audit(page, axe_source, route):
    for theme in ("light", "dark"):
        page.evaluate("theme => document.documentElement.dataset.theme = theme", theme)
        page.evaluate(axe_source)
        violations = page.evaluate("async () => (await axe.run(document, {runOnly: {type: 'tag', values: ['wcag2a','wcag2aa','wcag21aa','wcag22aa']}})).violations")
        assert not violations, (route, theme, [(item["id"], [node["target"] for node in item["nodes"]]) for item in violations])
        for width in (320, 390, 768, 1024, 1440):
            page.set_viewport_size({"width": width, "height": 900})
            assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 2"), (route, theme, width)


def main():
    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(QuietHandler, directory=str(ROOT / "web")))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{server.server_port}"
    axe_source = (ROOT / "apps/workbench/node_modules/axe-core/axe.min.js").read_text(encoding="utf-8")
    try:
        with sync_playwright() as runtime:
            browser = runtime.chromium.launch(headless=True)
            context = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce", permissions=["clipboard-read", "clipboard-write"])
            page = context.new_page()
            errors = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(base + "/", wait_until="load")
            page.get_by_role("heading", name="Know what your project can do.").wait_for()
            audit(page, axe_source, "home")
            page.evaluate("document.documentElement.dataset.theme = 'light'")
            page.set_viewport_size({"width": 1440, "height": 900})
            page.screenshot(path=str(ARTIFACTS / "public-home-desktop.png"), full_page=True)
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(ARTIFACTS / "public-home-mobile.png"), full_page=True)
            page.get_by_role("button", name="Copy the PRAXIS core CLI command").click()
            assert page.evaluate("navigator.clipboard.readText()") == "npx praxis-memory"
            page.get_by_role("link", name="Use PRAXIS locally").first.click()
            page.get_by_role("heading", name="Keep PRAXIS beside your project.").wait_for()
            audit(page, axe_source, "local setup")
            page.evaluate("document.documentElement.dataset.theme = 'light'")
            page.set_viewport_size({"width": 390, "height": 844})
            page.screenshot(path=str(ARTIFACTS / "public-local-mobile.png"), full_page=True)
            assert not errors, errors
            browser.close()
            print(json.dumps({"routes": ["home", "local setup"], "widths": [320, 390, 768, 1024, 1440], "themes": ["light", "dark"], "axe_violations": 0, "javascript_errors": errors}))
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
