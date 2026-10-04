"""Lossless browser frames at native pixel size, with real event timestamps.

Playwright's video recorder ignores device pixel density and can put a small
page in a larger canvas. This recorder rejects that size mismatch. It never
repaints UI, interpolates content or invents a click or backend result.
"""
import base64
import json
import math
from pathlib import Path
import struct
import subprocess


def png_size(data):
    assert data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR", "Not a native PNG frame"
    return struct.unpack(">II", data[16:24])


def timed_frames(frames, start, end):
    assert math.isfinite(start) and math.isfinite(end) and end > start
    assert frames, "No real browser frames recorded"
    assert all(math.isfinite(row['timestamp']) for row in frames)
    assert all(a['timestamp'] < b['timestamp'] for a, b in zip(frames, frames[1:])), "Frame timestamps regressed"
    before = [row for row in frames if row['timestamp'] <= start]
    assert before, "No native frame exists at the beginning of this take"
    selected = [before[-1]] + [row for row in frames if start < row['timestamp'] < end]
    cuts = [start] + [row['timestamp'] for row in selected[1:]] + [end]
    return [(row, cuts[i+1] - cuts[i]) for i, row in enumerate(selected)]


class NativeRecorder:
    def __init__(self, context, page, folder, width=3840, height=2160):
        self.folder = Path(folder).resolve()
        self.folder.mkdir(parents=True, exist_ok=False)
        self.width, self.height = width, height
        self.frames, self.errors = [], []
        self.session = context.new_cdp_session(page)
        self.session.send('Page.enable')
        self.session.on('Page.screencastFrame', self.capture)
        self.session.send('Page.startScreencast', {
            'format': 'png', 'maxWidth': width, 'maxHeight': height, 'everyNthFrame': 1,
        })

    def capture(self, event):
        try:
            data = base64.b64decode(event['data'], validate=True)
            assert png_size(data) == (self.width, self.height), "Recorder did not capture the whole native canvas"
            timestamp = event['metadata']['timestamp']
            assert math.isfinite(timestamp)
            target = self.folder / f"{len(self.frames):06d}.png"
            target.write_bytes(data)
            self.frames.append({'file': target.name, 'timestamp': timestamp})
        except Exception as error:
            self.errors.append(str(error))
        finally:
            self.session.send('Page.screencastFrameAck', {'sessionId': event['sessionId']})

    def finish(self, output, start, end):
        self.session.send('Page.stopScreencast')
        assert not self.errors, self.errors
        rows = timed_frames(self.frames, start, end)
        listing = self.folder / 'frames.ffconcat'
        # All names are generated here, not supplied by the reviewed project.
        listing.write_text('ffconcat version 1.0\n' + ''.join(
            f"file '{row['file']}'\nduration {duration:.9f}\n" for row, duration in rows
        ) + f"file '{rows[-1][0]['file']}'\n", encoding='utf-8')
        subprocess.run([
            'ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '1', '-i', str(listing),
            '-t', str(end-start), '-vf', 'fps=30', '-c:v', 'libx264', '-preset', 'fast',
            '-crf', '12', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', str(output),
        ], check=True)
        proof = {'capture': 'Chromium native PNG frames', 'width': self.width, 'height': self.height,
                 'event_frames': len(rows), 'seconds': end-start, 'output_fps': 30,
                 'cadence': 'Real browser changes; quiet frames are held at recorded timestamps.',
                 'max_event_gap_s': max(duration for _, duration in rows),
                 'small_canvas_rejected': True, 'frames': self.frames}
        (self.folder / 'native-proof.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
        return {k: v for k, v in proof.items() if k != 'frames'}
