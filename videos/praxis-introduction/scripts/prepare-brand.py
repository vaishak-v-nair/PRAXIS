"""Derive silent film assets from owned private masters without modifying them."""
import hashlib
import json
import subprocess
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
VAULT = PROJECT.parents[1] / "assets/source"
OUTPUT = PROJECT / "assets/brand"

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    records = []
    for name, duration in [("idle", 5.04), ("happy", 7.34), ("switching", 3.766667)]:
        source = VAULT / f"{name}.mp4"
        assert source.is_file(), f"Owned brand master missing: {source.name}"
        before = digest(source)
        target = OUTPUT / f"{name}.webm"
        subprocess.run([
            "ffmpeg", "-v", "error", "-y", "-i", str(source), "-t", str(duration), "-an",
            "-vf", "format=rgba,colorkey=0x000000:0.075:0.05,scale=1920:1080:flags=neighbor,format=yuva420p",
            "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "24", "-auto-alt-ref", "0", str(target),
        ], check=True)
        assert digest(source) == before, "Private source master changed"
        probe = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_streams", "-of", "json", str(target)
        ], text=True))
        assert len(probe["streams"]) == 1 and probe["streams"][0]["codec_type"] == "video"
        assert probe["streams"][0].get("tags", {}).get("alpha_mode") == "1", "Transparency missing"
        records.append({"source": f"assets/source/{source.name}", "source_sha256": before,
                        "derived": target.relative_to(PROJECT).as_posix(),
                        "derived_sha256": digest(target), "silent": True, "alpha": True,
                        "master_unchanged": True, "publication": "local film only"})
    proof = PROJECT / "capture/brand-review"
    proof.mkdir(parents=True, exist_ok=True)
    (proof / "provenance.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    print("Three silent transparent derivatives validated; private masters unchanged.")

if __name__ == "__main__":
    main()
