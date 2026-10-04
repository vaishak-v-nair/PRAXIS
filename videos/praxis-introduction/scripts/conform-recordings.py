"""Edit real footage, remove loading waits, and preserve the original takes.

All ranges trace to observed action marks or explicitly inspected screen times.
Screens, results and text are never repainted. Holds clone a real final frame.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
FULL_SCREEN = '--full-screen' in sys.argv
CAPTURE = PROJECT / ("capture/recordings-v4" if FULL_SCREEN else "capture/recordings-v2")
ARCHIVE = CAPTURE / "source-edits"
TEMP = PROJECT / ".hyperframes/edit-segments"

def length(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True))

def segment(source, start, seconds, target, output):
    assert 0 <= start < length(source) and seconds > 0 and target > 0
    seconds = min(seconds, length(source) - start)
    # Preserve the real motion cadence when a hold suffices. Condense only
    # source intervals that exceed the measured narration slot.
    rate = seconds / target if seconds > target else 1
    assert rate <= 1.6, f"Reading speed would be excessive: {source.name} {rate:.2f}x"
    vf = f"trim=start={start}:duration={seconds},setpts=(PTS-STARTPTS)/{rate},fps=30,tpad=stop_mode=clone:stop_duration={target}"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-vf", vf, "-t", str(target), "-an", "-c:v", "libx264", "-preset", "fast", "-crf", "12" if FULL_SCREEN else "16", "-pix_fmt", "yuv420p", str(output)], check=True)
    return {"source_start": round(start, 4), "source_duration": round(seconds, 4), "timeline_duration": round(target, 4), "playback_rate": round(rate, 4)}

def main():
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    TEMP.mkdir(parents=True, exist_ok=True)
    meta = json.loads((PROJECT / "audio_meta.json").read_text())
    proof = json.loads((CAPTURE / "recording-proof.json").read_text())
    actual = {item['frame']: item for item in proof['recordings']}
    report = []
    for voice in meta['voices']:
        n, target = voice['frame'], voice['duration_s']
        if n in (1, 13): continue
        assert n in actual, f"No observed capture provenance for scene {n}"
        path = PROJECT / actual[n]['path']
        source = ARCHIVE / path.name
        if not source.exists(): shutil.copyfile(path, source)
        duration = length(source)
        marks = actual[n].get('marks', {})
        ranges = []
        if n == 2:
            # Inspected landing, actual click, then stable browser trial. No
            # claim that the navigation delay disappeared in the real service.
            assert 'click' in marks and 'trial' in marks
            ranges = [(0, 2.0, 2.0), (marks['click']-.35, 1.55, 1.55), (marks['trial']+.1, 2.2, target-3.55)]
        elif n == 3:
            assert 'findings' in marks and 'handoff' in marks
            # The intermediate scroll carries a heading through the caption's
            # empty upper margin. Cut from the settled source selection directly
            # to the actual settled results; preserve the measured handoff cue.
            ranges = [(.1, 1.8, 2.0), (marks['findings']+.15, 3.4, 3.9), (marks['handoff']+.1, 4.8, target-5.9)]
        elif n == 9:
            assert 'passed' in marks and 'failed' in marks
            broken = next(word for word in voice['words'] if word['text'].lower() == 'broken')
            cue = max(3.5, broken['start']-.12)
            ranges = [(marks['passed'], 5.0, cue), (marks['failed'], min(7, duration-marks['failed']), target-cue)]
        elif n == 5 and FULL_SCREEN:
            assert 'goal_entered' in marks and 'budget_entered' in marks
            goal = next(word for word in voice['words'] if word['text'].lower() == 'add')['start']
            tests = next(word for word in voice['words'] if word['text'].lower() == 'tests')['start']
            # Read each actual route, then land on the filled goal and explicit
            # budget/trust controls at the matching spoken words.
            ranges = [(.15, 5.4, goal), (marks['goal_entered']+.1, 2.1, tests-goal),
                      (marks['budget_entered']+.1, 4.3, target-tests)]
        elif n == 10 and FULL_SCREEN:
            assert 'finding_landed' in marks and 'coverage_ready' in marks
            checks = next(word for word in voice['words'] if word['text'].lower() == 'checks')['start']
            ranges = [(marks['finding_landed']+.1, 4.7, checks),
                      (marks['coverage_ready']+.1, 5.2, target-checks)]
        elif n == 12 and FULL_SCREEN:
            assert 'activity_ready' in marks
            activity = next(word for word in voice['words'] if word['text'].lower() == 'activity')['start']-.2
            ranges = [(.15, 2.6, activity), (marks['activity_ready']+.1, 4.8, target-activity)]
        else:
            start = .15 if duration > target else 0
            seconds = min(duration-start, target*1.5)
            ranges = [(start, seconds, target)]
        cuts = []
        files = []
        for i, (start, seconds, slot) in enumerate(ranges):
            output = TEMP / f"{n:02d}-{i}.mp4"
            cuts.append(segment(source, start, seconds, slot, output))
            files.append(output)
        listing = TEMP / f"{n:02d}-concat.txt"
        listing.write_text("".join(f"file '{file.as_posix()}'\n" for file in files), encoding='utf-8')
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", "-movflags", "+faststart", str(path)], check=True)
        measured = length(path)
        assert abs(measured-target) < 2/30, f"Conformed duration mismatch {n}"
        report.append({"frame": n, "retained_take": source.relative_to(PROJECT).as_posix(), "output": path.relative_to(PROJECT).as_posix(), "duration": measured, "cuts": cuts, "actual_ui_preserved": True})
    (CAPTURE / "edit-proof.json").write_text(json.dumps(report, indent=2), encoding='utf-8')
    browser_cuts = next(row['cuts'] for row in report if row['frame'] == 3)
    gaps = sum(max(0,b['source_start']-a['source_start']-a['source_duration']) for a,b in zip(browser_cuts,browser_cuts[1:]))
    print(json.dumps({"edited_recordings": len(report), "actual_ui_preserved": True, "browser_source_gaps_omitted_seconds": round(gaps,4)}))

if __name__ == '__main__':
    main()
