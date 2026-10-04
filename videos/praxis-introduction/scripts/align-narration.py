"""Align this film's public narration, retaining measured speech timestamps.

Uploads only the authored public voiceover to Groq's transcription endpoint.
Never reads or submits projects, evidence, conversations or API key values.
"""
import difflib
import array
import json
import re
import subprocess
import wave
from pathlib import Path

import httpx
from dotenv import dotenv_values

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT.parents[1]
VOICE = PROJECT / "assets/voice-v2"

def duration(path):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(path)], text=True).strip())

def normal(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())

def main():
    source = VOICE / "full.mp3"
    assert source.exists(), "Download the completed narration before alignment"
    transcript_path = VOICE / "transcript-chunks.json"
    assert transcript_path.exists(), "Run the independently checked short-window transcription first"
    if not transcript_path.exists():
        key = dotenv_values(ROOT / "apps/workbench/.env").get("GROQ_API_KEY")
        assert key, "Groq transcription key is unavailable; never fabricate alignment"
        with source.open("rb") as audio:
            response = httpx.post("https://api.groq.com/openai/v1/audio/transcriptions",
                headers={"Authorization": "Bearer " + key},
                data={"model": "whisper-large-v3", "language": "en", "response_format": "verbose_json", "timestamp_granularities[]": "word", "temperature": "0", "prompt": "Praxis. AI. GitHub. Docker. Local source review. Public package."},
                files={"file": ("praxis-public-narration.mp3", audio, "audio/mpeg")}, timeout=90)
        if response.status_code != 200:
            raise RuntimeError(f"Transcription failed HTTP {response.status_code}; no fallback timestamps")
        transcript_path.write_text(json.dumps(response.json(), indent=2), encoding="utf-8")
    transcript = json.loads(transcript_path.read_text(encoding="utf-8"))
    scenes = json.loads((PROJECT / "revision-scenes.json").read_text(encoding="utf-8"))
    expected = [word for scene in scenes for word in scene["text"].split()]
    words = [w for w in transcript["words"] if normal(w["word"])]
    e, a = list(map(normal, expected)), [normal(w["word"]) for w in words]
    corrections = []
    # ASR hears the adjacent consonants in "fix plan" as "fixed plan". Keep the
    # authored public spelling and the observed timestamp, documenting this one
    # correction. Any other substitution, omission or insertion fails the build.
    if len(e) == len(a):
        for i in range(1, len(e) - 1):
            if e[i] == "fix" and a[i] == "fixed" and e[i-1:i+2] == ["a", "fix", "plan"]:
                corrections.append({"index": i, "asr": words[i]["word"], "caption": expected[i], "timestamp_unchanged": True})
                a[i] = e[i]
    changes = [item for item in difflib.SequenceMatcher(a=e, b=a, autojunk=False).get_opcodes() if item[0] != "equal"]
    report = {"provider": "ElevenLabs Chris via vidIQ MCP", "timing": "Groq Whisper large v3 transcription, estimated alignment", "expected_words": len(e), "observed_words": len(a), "documented_asr_corrections": corrections, "changes": [{"kind": tag, "script": expected[i:j], "heard": [x['word'] for x in words[k:l]]} for tag, i, j, k, l in changes]}
    (VOICE / "alignment-qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    assert not changes, json.dumps(report, indent=2)
    total = duration(source)
    indices, cursor = [], 0
    for scene in scenes:
        indices.append(cursor)
        cursor += len(scene["text"].split())
    pcm = VOICE / "timing-reference.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", str(pcm)], check=True)
    quiet = []
    with wave.open(str(pcm), "rb") as stream:
        step, clock, opened = 160, 0.0, None
        while block := stream.readframes(step):
            samples = array.array("h", block)
            rms = (sum(value * value for value in samples) / len(samples)) ** .5 / 32768
            if rms < .012:
                if opened is None: opened = clock
            elif opened is not None:
                if clock - opened >= .08: quiet.append((opened, clock))
                opened = None
            clock += len(samples) / 16000
    boundaries = [0.0]
    cuts = []
    for index in indices[1:]:
        estimate = (words[index - 1]["end"] + words[index]["start"]) / 2
        candidates = [(a, b) for a, b in quiet if abs((a+b)/2 - estimate) < .8]
        assert candidates, f"No actual breathing pause near {estimate}; inspect before cutting speech"
        a, b = min(candidates, key=lambda interval: abs(sum(interval)/2 - estimate))
        cut = round((a+b) / 2, 4)
        boundaries.append(cut)
        cuts.append({"asr_estimate": round(estimate, 3), "actual_quiet_interval": [round(a, 3), round(b, 3)], "cut": cut})
    boundaries.append(total)
    report["speech_boundary_cuts"] = cuts
    (VOICE / "alignment-qa.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    voices = []
    for n, scene in enumerate(scenes):
        start, end = boundaries[n:n + 2]
        selected = words[indices[n]: indices[n + 1] if n + 1 < len(indices) else len(words)]
        name = f"{scene['frame']:02d}.wav"
        # Add a small reading breath after each chapter; never time-stretch speech.
        breath = 1.35 if scene['frame'] in (3, 9, 11) else .8
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(source), "-af", f"atrim=start={start}:end={end},asetpts=PTS-STARTPTS,apad=pad_dur={breath}", "-ar", "44100", "-ac", "1", str(VOICE / name)], check=True)
        measured = duration(VOICE / name)
        # Whisper word boundaries are approximate and may overlap. Subtitles use
        # phrase timing, not karaoke. Clamp display ranges to their real chapter
        # window, while retaining every raw measurement in the audit transcript.
        framed = [{"id": f"w{i+1}", "text": expected[indices[n] + i], "start": round(max(0, w["start"] - start), 4), "end": round(min(end - start, w["end"] - start), 4)} for i, w in enumerate(selected)]
        invalid = [w for w in framed if not 0 <= w["start"] <= w["end"] <= measured + 1/44100]
        assert not invalid, f"Frame {scene['frame']} {start:.3f}–{end:.3f}: {invalid}"
        voices.append({"frame": scene["frame"], "path": "assets/voice-v2/" + name, "duration_s": measured, "words": framed})
    meta = {"bgm": None, "bgm_pending": False, "voices": voices, "provenance": report}
    (PROJECT / "audio_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(json.dumps({"scenes": len(voices), "words": len(words), "duration": sum(v['duration_s'] for v in voices), "alignment_changes": len(changes)}))

if __name__ == "__main__":
    main()
