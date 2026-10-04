"""Check the public neural narration in short independent ASR windows."""
import concurrent.futures
import json
import subprocess
from pathlib import Path
import httpx
from dotenv import dotenv_values

PROJECT = Path(__file__).resolve().parents[1]
VOICE = PROJECT / "assets/voice-v2"
ROOT = PROJECT.parents[1]

def main():
    key = dotenv_values(ROOT / "apps/workbench/.env").get("GROQ_API_KEY")
    assert key
    total = float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", str(VOICE / "full.mp3")], text=True))
    windows = [(n, start, min(28, total - start)) for n, start in enumerate(range(0, int(total), 26))]
    def transcribe(window):
        n, start, length = window
        out = VOICE / f"chunk-{n:02d}.json"
        if out.exists():
            return start, json.loads(out.read_text(encoding="utf-8"))
        audio = VOICE / f"chunk-{n:02d}.flac"
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-ss", str(start), "-i", str(VOICE / "full.mp3"), "-t", str(length), "-ar", "16000", "-ac", "1", str(audio)], check=True)
        with audio.open("rb") as file:
            response = httpx.post("https://api.groq.com/openai/v1/audio/transcriptions", headers={"Authorization": "Bearer " + key}, data={"model": "whisper-large-v3", "language": "en", "response_format": "verbose_json", "timestamp_granularities[]": "word", "temperature": "0", "prompt": "Praxis. AI. GitHub. Docker."}, files={"file": (audio.name, file, "audio/flac")}, timeout=90)
        if response.status_code != 200:
            raise RuntimeError(f"Audio window {n} transcription HTTP {response.status_code}")
        result = response.json()
        out.write_text(json.dumps(result, indent=2), encoding="utf-8")
        return start, result
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        outputs = sorted(pool.map(transcribe, windows))
    words = []
    for start, result in outputs:
        next_cut = start + 26 if start + 26 < total else total + 1
        # Ownership by midpoint retains words straddling a cut exactly once.
        words.extend({**word, "start": round(word['start'] + start, 4), "end": round(word['end'] + start, 4)} for word in result['words'] if start <= start + (word['start'] + word['end']) / 2 < next_cut)
    result = {"text": " ".join(word['word'] for word in words), "words": words, "duration": total, "method": "28 second ASR windows with 2 second overlap; midpoint ownership"}
    (VOICE / "transcript-chunks.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(result['text'])

if __name__ == "__main__":
    main()
