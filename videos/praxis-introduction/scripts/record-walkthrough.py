"""Record real browser actions against the public site and running local tool.

Only the deliberately constructed course-demo source is selected. Existing
model results and Docker logs are inspected; this does not buy another review,
repair source, or fabricate a result. UI cursor marks follow actual pointer events.
"""
import hashlib
import json
import subprocess
import sys
import time
from pathlib import Path

import httpx
from playwright.sync_api import sync_playwright
from native_recorder import NativeRecorder

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
APP = ROOT / "apps/workbench"
OUT = PROJECT / "assets/recordings"
RAW = PROJECT / "capture/recordings-v2"
FULL_SCREEN = '--full-screen' in sys.argv
if FULL_SCREEN:
    OUT = PROJECT / 'assets/recordings-v4'
    RAW = PROJECT / 'capture/recordings-v4'
SITE = "https://praxis-six-xi.vercel.app"
UI = "http://127.0.0.1:3000"
API = "http://127.0.0.1:9123/api"

def fingerprint(folder):
    return hashlib.sha256(b"".join(file.relative_to(folder).as_posix().encode() + file.read_bytes() for file in sorted(folder.rglob("*")) if file.is_file())).hexdigest()

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    proof = json.loads((APP / ".regen/artifacts/team-smoke.json").read_text())
    good, bad = proof["working_job"], proof["broken_job"]
    sources = [Path(source) for source in proof["source_paths"]]
    before = [fingerprint(source) for source in sources]
    final = httpx.get(API + "/jobs/" + bad, timeout=20).json()
    assert final.get("fix_plan") and not final.get("fix"), "Use the real existing plan without implementation"
    scenes = json.loads((PROJECT / "revision-scenes.json").read_text())
    prior = RAW / "recording-proof.json"
    inventory = json.loads(prior.read_text()).get('recordings', []) if prior.exists() else []
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-proxy-server"])
        requested = {int(item) for item in sys.argv[1:] if item != '--full-screen'}
        for scene in scenes:
            n, slug = scene["frame"], scene["slug"]
            if n in (1, 13):
                continue
            if requested and n not in requested:
                continue
            if (OUT / f"{n:02d}-{slug}.mp4").exists():
                if not requested:
                    continue
                old = OUT / f"{n:02d}-{slug}.mp4"
                retained = RAW / f"{n:02d}-{slug}-previous-{time.time_ns()}.mp4"
                assert old.resolve().is_relative_to(PROJECT.resolve()) and retained.resolve().is_relative_to(PROJECT.resolve())
                old.rename(retained)
            scale = 3 if FULL_SCREEN else 1
            options = {'viewport': {'width':3840,'height':2160} if FULL_SCREEN else {'width':1280,'height':800},
                       'permissions': ['clipboard-read','clipboard-write']}
            if not FULL_SCREEN:
                options.update(record_video_dir=str(RAW), record_video_size={'width':1280,'height':800})
            context = browser.new_context(**options)
            if FULL_SCREEN:
                # Presentation zoom changes only this filming browser. Native
                # viewport pixels are captured losslessly; app/source stay intact.
                context.add_init_script(f"document.addEventListener('DOMContentLoaded',()=>document.documentElement.style.zoom='{scale}',{{once:true}})")
            page = context.new_page()
            video = page.video
            created = time.monotonic()
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.set_default_navigation_timeout(90000)
            cursor = """(() => { const dot=document.createElement('div'); dot.id='recorded-pointer'; Object.assign(dot.style,{position:'fixed',width:'14px',height:'14px',border:'2px solid white',borderRadius:'50%',background:'#3975c7',boxShadow:'0 0 0 2px #0b0f17',pointerEvents:'none',zIndex:'2147483647',left:'-100px',top:'-100px'}); document.documentElement.appendChild(dot); const zoom=Number(getComputedStyle(document.documentElement).zoom)||1; document.addEventListener('pointermove',e=>{dot.style.left=(e.clientX/zoom-8)+'px';dot.style.top=(e.clientY/zoom-8)+'px'},true); document.addEventListener('pointerdown',()=>dot.style.background='#ffffff',true); document.addEventListener('pointerup',()=>dot.style.background='#3975c7',true); })()"""
            def focus(locator):
                locator.first.wait_for()
                locator.first.evaluate("(el,top) => window.scrollTo({top: Math.max(0,window.scrollY+el.getBoundingClientRect().top-top),behavior:'smooth'})", 90*scale if FULL_SCREEN else 126)
                page.wait_for_timeout(700)
            def click(locator):
                locator.first.scroll_into_view_if_needed()
                box = locator.first.bounding_box()
                page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] / 2, steps=28)
                page.wait_for_timeout(220)
                locator.first.click()
                page.wait_for_timeout(500)
            def nav(name):
                click(page.get_by_role("navigation", name="Review sections").get_by_role("button", name=name, exact=name != 'findings'))
            def wait(seconds):
                page.wait_for_timeout(int(seconds * 1000))
            if n in (2, 3):
                response = page.goto(SITE if n == 2 else SITE + "/test-your-project/", wait_until="load")
                assert response.ok
                if n == 2:
                    # Keep the whole headline and the actual CTA inside the
                    # recorded focus window, rather than clipping its label.
                    page.evaluate("window.scrollTo(0,32)")
                    if FULL_SCREEN:
                        focus(page.get_by_role('heading',level=1))
                    page.wait_for_timeout(700)
                if n == 3:
                    page.wait_for_function("() => typeof document.getElementById('folder').onchange === 'function'", timeout=90000)
                    focus(page.get_by_role("heading", name="Test your project", exact=True))
            else:
                page.goto(UI + ("" if n in (4, 5) else "/?job=" + (good if n == 9 else bad)), wait_until="load")
                if n in (4, 5):
                    page.locator(".intake-panel").wait_for()
                    if n == 4:
                        page.evaluate("window.scrollTo({top:0,behavior:'instant'})")
                    else:
                        focus(page.locator(".intake-panel"))
                else:
                    page.locator(".project-actions").get_by_text("Complete", exact=False).wait_for()
                    nav("workspace" if n in (6, 7, 8) else "execution" if n == 9 else "findings" if n == 10 else "changes" if n == 11 else "source map")
                    focus(page.locator(".pressure-results" if n in (6, 7) else ".shared-grid" if n == 8 else ".log-list" if n == 9 else ".triage" if n == 10 else ".repair-plan" if n == 11 else ".source-explorer"))
            page.evaluate(cursor)
            recorder = NativeRecorder(context, page, RAW/f'{n:02d}-{slug}-{time.time_ns()}') if FULL_SCREEN else None
            wait(.8)
            offset = time.monotonic() - created
            started_wall = time.time()
            actions, marks = [], {}
            def mark(name):
                marks[name] = round(time.monotonic() - created - offset, 4)
            if n == 2:
                page.mouse.move(280, 400, steps=25)
                wait(2)
                button = page.get_by_role("link", name="Test Your Project").first
                box = button.bounding_box()
                assert box['y'] >= (0 if FULL_SCREEN else 108) and box['y'] + box['height'] <= (1900 if FULL_SCREEN else 610), "Website CTA is cropped"
                button.hover()
                wait(2)
                mark('click')
                click(button)
                page.get_by_role("heading", name="Test your project", exact=True).wait_for()
                focus(page.get_by_role("heading", name="Test your project", exact=True))
                mark('trial')
                wait(5)
                actions = ["Official landing page loaded", "Clicked Test Your Project", "Browser trial opened"]
            elif n == 3:
                mark('folder')
                page.locator("#folder").set_input_files(str(sources[1]))
                wait(2)
                focus(page.locator("#run"))
                click(page.locator("#run"))
                page.locator("#results:not([hidden]), #error:not([hidden])").wait_for(timeout=150000)
                assert page.locator("#error").is_hidden()
                assert page.locator(".finding").count() > 0
                focus(page.locator("#results"))
                mark('findings')
                wait(4)
                focus(page.get_by_role("button", name="Copy agent prompt", exact=True))
                mark('handoff')
                click(page.get_by_role("button", name="Copy agent prompt", exact=True))
                page.get_by_text("Agent prompt copied. Review and confirm the plan in your agent.", exact=True).wait_for()
                assert "NOT EXECUTED" in page.evaluate("navigator.clipboard.readText()")
                wait(5)
                actions = ["Demo folder selected", "Real browser source check completed", "Real clipboard contains prompt with NOT EXECUTED scope"]
            elif n == 4:
                page.mouse.move(240, 260, steps=25)
                wait(7)
                actions = ["Actual running local source-checkout UI and runtime connection"]
            elif n == 5:
                click(page.get_by_role("button", name="GitHub URL", exact=True))
                wait(1)
                click(page.get_by_role("button", name="Upload folder", exact=True))
                wait(1)
                click(page.get_by_role("button", name="Local path", exact=True))
                # Intake is demonstrated without sending another job or exposing a personal path.
                click(page.locator(".review-details > summary"))
                focus(page.get_by_placeholder("Describe the user workflow and anything you want checked."))
                page.get_by_placeholder("Describe the user workflow and anything you want checked.").fill("Save each order and reject invalid input.")
                mark('goal_entered')
                wait(2)
                focus(page.get_by_label("Model budget in dollars", exact=True))
                page.get_by_label("Model budget in dollars", exact=True).fill("1")
                mark('budget_entered')
                wait(5)
                actions = ["Three actual source routes", "Entered a goal", "Budget and unchecked explicit runtime trust shown", "No new review submitted"]
            elif n == 6:
                page.mouse.move(340, 200, steps=25)
                labels = page.locator('.pressure-results').locator('h3, h4')
                assert labels.count() == 4, "The recorded team must contain four actual specialist reports"
                def visible_roles(indices):
                    boxes = [labels.nth(index).bounding_box() for index in indices]
                    assert all(box and box['y'] >= (0 if FULL_SCREEN else 108) and box['y'] + box['height'] <= (1900 if FULL_SCREEN else 610) for box in boxes), "Agent names are cropped"
                # The balanced dashboard has two rows. Read each actual row;
                # never squeeze four reports into a smaller synthetic layout.
                focus(labels.nth(0))
                visible_roles((0, 1))
                mark('first_roles')
                wait(3.6)
                focus(labels.nth(2))
                visible_roles((2, 3))
                mark('remaining_roles')
                wait(4.8)
                actions = ["Actual specialist results", "Read the first two roles, then scrolled to the remaining two", "Source-backed findings and unavailable providers retained"]
            elif n == 7:
                page.mouse.move(920, 270, steps=25)
                wait(3)
                details = page.locator(".team-discussions")
                focus(details)
                click(details.locator("summary"))
                wait(6)
                actions = ["Actual partial provider state", "Expanded recorded peer evidence"]
            elif n == 8:
                page.mouse.move(210, 400, steps=25)
                page.get_by_label("Note type", exact=True).select_option("goal")
                addressing = page.get_by_label("Address to", exact=True)
                options = addressing.locator('option').evaluate_all("items => items.map(el => ({value:el.value,label:el.textContent}))")
                match = [item for item in options if 'reliability' in item['label'].lower()]
                assert len(match) == 1
                addressing.select_option(value=match[0]['value'])
                page.get_by_placeholder("What should the people and agents focus on?").fill("Check that success means the order was actually saved.")
                wait(3)
                focus(page.locator(".shared-discussion"))
                wait(5)
                actions = ["Addressed reliability specialist", "Real existing two-contributor discussion", "Sharing is unchecked; new draft not posted or sent to models"]
            elif n == 9:
                details = page.locator(".log-list details").last
                if details.get_attribute("open") is None:
                    click(details.locator("summary"))
                focus(details)
                assert details.evaluate("el => el.open"), "Passing test log must be expanded"
                assert "OK" in details.inner_text(), "Record actual passing test output"
                mark('passed')
                wait(5)
                mark('passed_end')
                page.goto(UI + "/?job=" + bad, wait_until="load")
                page.locator(".project-actions").get_by_text("Complete", exact=False).wait_for()
                nav("execution")
                details = page.locator(".log-list details").last
                if details.get_attribute("open") is None:
                    click(details.locator("summary"))
                focus(details)
                assert details.evaluate("el => el.open"), "Failing test log must be expanded"
                assert "FAILED" in details.inner_text(), "Record actual assertion failure"
                page.evaluate(cursor)
                mark('failed')
                wait(7)
                actions = ["Recorded passing Docker tests", "Recorded failing Docker tests for success without a persisted row"]
            elif n == 10:
                button = page.get_by_role("button", name="Write-named function returns constant success", exact=False)
                click(button)
                focus(page.locator(".evidence-inspector"))
                mark('finding_landed')
                wait(5)
                nav('execution')
                coverage = page.locator('.coverage-list').get_by_text('Semgrep', exact=True)
                focus(coverage)
                assert 'Semgrep is not installed.' in page.locator('.coverage-list').inner_text()
                mark('coverage_ready')
                wait(5.5)
                actions = ["Opened real constant-success finding", "Read observed impact and recorded source", "Inspected actual skipped checks; no missing tool was reported as passed"]
            elif n == 11:
                page.mouse.move(600, 380, steps=25)
                wait(3)
                page.mouse.wheel(0, 270*scale)
                wait(3)
                copy = page.get_by_role("button", name="Copy AI handoff", exact=True)
                focus(copy)
                click(copy)
                page.get_by_role("button", name="Plan copied", exact=True).wait_for()
                assert "PRAXIS repair handoff" in page.evaluate("navigator.clipboard.readText()")
                note = page.get_by_text("No implementation has been authorized yet", exact=False).bounding_box()
                assert note['y'] >= (0 if FULL_SCREEN else 128) and note['y'] + note['height'] <= (1900 if FULL_SCREEN else 630), "Plan authorization note is cropped"
                wait(5)
                actions = ["Inspected existing real provider plan", "Copied actual implementation brief", "No original files changed"]
            elif n == 12:
                page.mouse.move(450, 370, steps=25)
                wait(4)
                nav("activity")
                focus(page.get_by_role("heading", name="Review activity", exact=True))
                mark('activity_ready')
                wait(5)
                actions = ["Actual parsed source map", "Actual recorded backend activity"]
            elapsed = time.monotonic() - created - offset
            ended_wall = time.time()
            page.screenshot(path=str(OUT / f"{n:02d}-{slug}-poster.png"))
            target = OUT / f"{n:02d}-{slug}.mp4"
            # A fixed focus window enlarges genuine UI without altering its pixels/status.
            crop_y = 0 if FULL_SCREEN else 128 if n == 11 else 108
            native_proof = recorder.finish(target, started_wall, ended_wall) if recorder else None
            context.close()
            raw = recorder.folder if recorder else Path(video.path())
            if not FULL_SCREEN:
                subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(offset), "-i", str(raw), "-t", str(elapsed), "-vf", f"crop=1224:502:28:{crop_y},fps=30", "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", str(target)], check=True)
            inventory = [item for item in inventory if item['frame'] != n]
            inventory.append({"frame": n, "path": target.relative_to(PROJECT).as_posix(), "raw_take": raw.relative_to(PROJECT).as_posix(), "crop": {"x":0 if FULL_SCREEN else 28,"y":crop_y,"width":3840 if FULL_SCREEN else 1224,"height":2160 if FULL_SCREEN else 502}, "native_proof":native_proof,"presentation_zoom":scale, "actions": actions, "marks": marks, "seconds": round(elapsed, 3), "source": SITE if n in (2, 3) else "Local source checkout; existing course-demo job", "source_job": good if n == 9 else bad if n >= 6 else None})
            (RAW / "recording-proof.json").write_text(json.dumps({"recordings": inventory, "page_errors": errors}, indent=2), encoding="utf-8")
            print(f"Recorded {n:02d}-{slug}: {elapsed:.1f}s", flush=True)
        browser.close()
    assert not errors, errors
    assert before == [fingerprint(source) for source in sources], "Original project source changed"
    after = httpx.get(API + "/jobs/" + bad, timeout=20).json()
    assert after['cost'] == final['cost'] and not after.get('fix'), "Filming must not buy review or repair source"
    (RAW / "source-integrity.json").write_text(json.dumps({"unchanged": True, "model_spend_changed": False, "source_apply": False, "fingerprints": before}, indent=2), encoding="utf-8")
    print("Real recordings complete; source and budget unchanged", flush=True)

if __name__ == "__main__":
    main()
