"""Keep authored word order when estimated ASR onsets overlap or regress.

Raw voice metadata and transcription stay intact. Only the caption-builder input
gets the smallest monotonic onset adjustment; this is not exact word alignment.
"""
from copy import deepcopy
import json
from pathlib import Path
import re

PROJECT = Path(__file__).resolve().parents[1]

def normal(word):
    return re.sub(r"[^a-z0-9]", "", word.lower())

def prepare(meta, scenes):
    out = deepcopy(meta)
    expected = {s["frame"]: s["text"].split() for s in scenes}
    changes = []
    for voice in out["voices"]:
        words = voice["words"]
        if [normal(w["text"]) for w in words] != [normal(w) for w in expected[voice["frame"]]]:
            raise ValueError(f"Caption words differ from the script in frame {voice['frame']}")
        previous = 0
        for i, word in enumerate(words):
            if not 0 <= word["start"] <= word["end"] <= voice["duration_s"] + 1 / 44100:
                raise ValueError("Raw ASR range lies outside its measured voice chapter")
            raw = word["start"]
            if raw < previous:
                word["start"] = previous
                word["end"] = max(word["end"], previous)
                changes.append({"frame": voice["frame"], "word": i, "text": word["text"],
                                "raw_start": raw, "display_start": previous})
            previous = word["start"]
    out["caption_timing"] = {"method": "minimal monotonic correction of estimated ASR onsets",
                              "raw_preserved": True, "adjustments": changes}
    return out

def main():
    meta = json.loads((PROJECT / "audio_meta.json").read_text(encoding="utf-8"))
    scenes = json.loads((PROJECT / "revision-scenes.json").read_text(encoding="utf-8"))
    out = prepare(meta, scenes)
    (PROJECT / "audio_meta_captions.json").write_text(json.dumps(out, indent=2), encoding="utf-8")
    audit = PROJECT / "capture/recordings-v2"
    audit.mkdir(parents=True, exist_ok=True)
    (audit / "caption-timing-adjustments.json").write_text(json.dumps(out["caption_timing"], indent=2), encoding="utf-8")
    print(json.dumps({"words": sum(len(v['words']) for v in out['voices']),
                      "adjusted_onsets": len(out['caption_timing']['adjustments']), "raw_preserved": True}))

if __name__ == "__main__":
    main()
