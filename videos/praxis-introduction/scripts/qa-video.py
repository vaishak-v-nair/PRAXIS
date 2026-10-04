"""Audit the actual compiled film: words, caption geometry, media and seeking."""
import hashlib
import json
from pathlib import Path
import re
import sys
import time as wall_clock
from playwright.sync_api import sync_playwright
from subtitle_export import webvtt

PROJECT = Path(__file__).resolve().parents[1]
URL = "http://127.0.0.1:3002/api/projects/praxis-introduction/preview?__hf_shader_capture_scale=1&__hf_shader_loading=player"

def seek(page, seconds):
    # Match Hyperframes snapshot's preferred render target. The preview message
    # bridge can reset a sub-composition during rapid seeks; renderSeek owns the
    # exact-time renderer path and media. Never seek native video manually.
    page.evaluate("""async t=>{
      window.__player.renderSeek(t,{exact:true});
      window.gsap.ticker.tick();
      await window.__hfWaitForSeekCompletion();
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    }""", seconds)
    caption_time = page.evaluate("() => window.__timelines.captions.time()")
    assert abs(caption_time-seconds) <= 1e-5, f"Subtitle seek did not settle at {seconds}s: {caption_time}"
    return seconds

def normal(text):
    return re.sub(r"[^a-z0-9]", "", text.lower())

def main():
    out = PROJECT / "capture/qa-v4"
    out.mkdir(parents=True, exist_ok=True)
    meta = json.loads((PROJECT / "audio_meta.json").read_text(encoding="utf-8"))
    expected = [w["text"] for v in meta["voices"] for w in v["words"]]
    groups = json.loads((PROJECT / "caption_groups.json").read_text(encoding="utf-8"))["groups"]
    assert [w["text"] for g in groups for w in g["words"]] == expected
    errors = []
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=["--no-proxy-server"])
        page = browser.new_page(viewport={"width": 1920, "height": 1080})
        page.add_init_script("""window.__qaReady=false;window.__qaAssetsReady=false;window.__qaState=null;
          window.addEventListener('message',e=>{if(e.data?.source!=='hf-preview')return;
            if(e.data.type==='ready')window.__qaReady=true;
            if(e.data.type==='assets-ready' && !e.data.timedOut)window.__qaAssetsReady=true;
            if(e.data.type==='state')window.__qaState=e.data;});""")
        page.on("pageerror", lambda error: errors.append(str(error)))
        response = page.goto(URL, wait_until="load")
        assert response.ok, "Compiled film preview is unavailable"
        # A deterministic renderer may virtualize in-page timers/RAF. Poll from
        # the external test clock; never depend on a paused composition's clock.
        deadline = wall_clock.monotonic() + 15
        while not page.evaluate("() => window.__qaReady && window.__qaAssetsReady && typeof window.__player?.renderSeek==='function' && document.querySelectorAll('[data-caption-start]').length>0"):
            assert wall_clock.monotonic() < deadline, f"Compiled film did not become ready: {errors}"
            page.wait_for_timeout(100)
        page.evaluate("document.fonts.ready")
        captions = page.locator("[data-caption-start]").evaluate_all("els=>els.map(e=>({text:e.innerText,start:+e.dataset.captionStart,end:+e.dataset.captionEnd}))")
        assert normal(" ".join(c["text"] for c in captions)) == normal(" ".join(expected))
        assert page.locator("video").count() == 13, "Native media was duplicated or dropped"
        assert len({v for v in page.locator("video").evaluate_all("els=>els.map(e=>e.id)")}) == 13
        for a, b in zip(captions, captions[1:]):
            assert a["start"] < a["end"] <= b["start"], "Subtitle windows overlap or regress"

        # Retain dense samples around the independently found browser collision,
        # as well as the complete closing reading hold. These stills complement
        # geometry checks; they do not pretend to detect semantic UI occlusion.
        samples = sorted({0.01, 3.38, 4.60, 16.766, 16.834, 91.18, 120, 121.5, 124.68}
                         | {13 + frame/30 for frame in range(13)}
                         | {(c["start"] + c["end"]) / 2 for c in captions})
        cursor, scene_samples = 0, []
        for voice in meta["voices"]:
            scene_samples.append(cursor + voice["duration_s"] / 2)
            if cursor:
                samples.extend([cursor - .034, cursor + .034])
            cursor += voice["duration_s"]
        samples = sorted(set(samples + scene_samples))
        boundary_tolerance_samples = 0
        for time in samples:
            actual_time = seek(page, time)
            state = page.evaluate("""() => {
              const visible=Array.from(document.querySelectorAll('[data-caption-start]'))
                .filter(e=>getComputedStyle(e).opacity>.5 && e.getBoundingClientRect().width>0);
              return visible.map(e=>{const p=e.querySelector('p'),r=p.getBoundingClientRect(),s=getComputedStyle(p);
                return {text:p.textContent,x:r.x,y:r.y,right:r.right,bottom:r.bottom,
                        lines:(r.height-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom))/parseFloat(s.lineHeight),scroll:p.scrollWidth,width:p.clientWidth};});
            }""")
            assert len(state) <= 1, f"Two subtitle phrases are visible at {time:.3f}s"
            # Caption cues are continuous seconds; native export is 30fps.
            # Require every interior cue and permit only one frame at a cut.
            interior = [c for c in captions if c['start']+1/30 <= actual_time < c['end']-1/30]
            allowed = [c for c in captions if c['start']-1/30 <= actual_time < c['end']+1/30]
            assert not interior or len(state) == 1, f"Subtitle missing at {time:.3f}s"
            assert all(cap['text'] in [c['text'] for c in allowed] for cap in state), f"Stale subtitle at {time:.3f}s: {state}"
            if state and not interior:
                boundary_tolerance_samples += 1
            for cap in state:
                if 10.9 <= time < 16.8:
                    safe = (1130, 0, 1872, 90)
                elif 16.8 <= time < 22.185011:
                    safe = (72, 920, 1036, 1024)
                elif 22.185011 <= time < 117.35:
                    safe = (560, 986, 1480, 1074)
                else:
                    safe = (192, 920, 1728, 1024)
                assert cap['x'] >= safe[0]-1 and cap['y'] >= safe[1]-1 and cap['right'] <= safe[2]+1 and cap['bottom'] <= safe[3]+1, (time, cap, safe)
                assert cap["lines"] <= 2.05 and cap["scroll"] <= cap["width"] + 1, (time, cap)

            active_video = page.evaluate("""() => Array.from(document.querySelectorAll('video[id$="-recording"]'))
              .filter(v=>getComputedStyle(v).display!=='none' && getComputedStyle(v).visibility!=='hidden')
              .map(v=>{const r=v.getBoundingClientRect();return {id:v.id,x:r.x,y:r.y,width:r.width,height:r.height,
                nativeWidth:v.videoWidth,nativeHeight:v.videoHeight};})""")
            for video in active_video:
                assert video['nativeWidth']==3840 and video['nativeHeight']==2160, (time,video)
                assert video['x']<=1 and video['y']<=1 and video['width']>=1919 and video['height']>=1079, (time,video)
            if '--stills' in sys.argv:
                stills = PROJECT / 'snapshots/v4-final'
                stills.mkdir(parents=True, exist_ok=True)
                page.screenshot(path=str(stills / f'frame-at-{time:08.3f}s.png'))

        closing = []
        for time in (120, 121.5):
            seek(page, time)
            measured = page.locator('#f13-close-domain, #f13-close-action').evaluate_all("""els=>els.map(e=>{
              const r=e.getBoundingClientRect(),s=getComputedStyle(e),range=document.createRange();
              range.selectNodeContents(e);const text=range.getBoundingClientRect();
              return {id:e.id,x:r.x,y:r.y,right:r.right,bottom:r.bottom,textRight:text.right,
                      fontPixelsAt390:parseFloat(s.fontSize)*390/1920,scroll:e.scrollWidth,width:e.clientWidth};
            })""")
            assert len(measured) == 2, 'Closing URL or next action was dropped'
            for item in measured:
                assert item['fontPixelsAt390'] >= 12, ('Phone-width closing copy is too small',time,item)
                assert item['textRight'] <= item['right'] + 1 and item['scroll'] <= item['width'] + 1, (time,item)
                assert 0 <= item['x'] < item['right'] <= 1920 and 0 <= item['y'] < item['bottom'] < 920, (time,item)
            closing.append({'seconds':time,'copy':measured})
        page.screenshot(path=str(out / 'closing.png'))

        seek_hashes = []
        for times in [[0.02, 3.6], [123, 80, 3.6]]:
            for time in times:
                seek(page, time)
            seek_hashes.append(hashlib.sha256(page.screenshot()).hexdigest())
        assert seek_hashes[0] == seek_hashes[1], "The opening differs after reverse seeking"
        page.screenshot(path=str(out / "opening.png"))
        # Negative control: an extra active subtitle must be detectable. Restore
        # it immediately; no contaminated preview or capture is delivered.
        duplicate = page.locator("[data-caption-start]").last
        saved = duplicate.get_attribute("style")
        duplicate.evaluate("e=>e.style.opacity='1'")
        active = page.locator("[data-caption-start]").evaluate_all("els=>els.filter(e=>getComputedStyle(e).opacity>.5).length")
        assert active == 2, "Overlap negative control did not exercise the detector"
        duplicate.evaluate("(e,s)=>s===null?e.removeAttribute('style'):e.setAttribute('style',s)", saved)
        assert not errors, errors
        browser.close()
    exports = PROJECT / 'renders'
    exports.mkdir(exist_ok=True)
    (exports / 'praxis-introduction.vtt').write_text(webvtt(captions, cursor), encoding='utf-8')
    report = {"caption_words": len(expected), "exact_script_order": True, "phrases": len(captions),
              "seek_samples": len(samples), "caption_overlap": False, "caption_overflow": False,
              "native_media": 13, "duplicate_media": False, "reverse_seek_pixels_identical": True,
              "native_product_recordings": "3840x2160", "product_framing": "Full canvas, restrained approach zooms",
              "boundary_tolerance_seconds": 1/30, "boundary_tolerance_samples": boundary_tolerance_samples,
              "overlap_negative_control": True, "page_errors": errors,
              "closing_phone_width": 390, "closing_reading_hold_seconds": 1.5,
              "closing_copy_bounds": closing,
              "caption_safe_regions": "Browser empty margins; local fixed footer center; brand lower margin",
              "limits": "Geometry sampled at phrase midpoints, scene midpoints and native-frame cuts. Empty regions require visual review; semantic occlusion is not inferred by this test. ASR timing is estimated; listening is not claimed."}
    (out / "browser-qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report))

if __name__ == "__main__":
    main()
