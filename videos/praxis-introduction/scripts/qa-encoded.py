"""Check actual exported picture/audio, rather than a render job's status."""
import argparse
from fractions import Fraction
import json
import math
from pathlib import Path
import re
import subprocess


def validate_probe(probe, width, height, expected_duration):
    videos = [s for s in probe['streams'] if s['codec_type'] == 'video']
    audios = [s for s in probe['streams'] if s['codec_type'] == 'audio']
    assert len(videos) == len(audios) == 1, 'Delivery must have one picture and one narration stream'
    video, audio = videos[0], audios[0]
    assert (video['width'], video['height']) == (width, height), 'Encoded dimensions do not match delivery'
    assert Fraction(video['avg_frame_rate']) == 30, 'Encoded cadence is not 30fps'
    picture_seconds = float(video['duration'])
    audio_seconds = float(audio['duration'])
    assert math.isfinite(picture_seconds) and math.isfinite(audio_seconds)
    assert abs(picture_seconds-expected_duration) <= 2/30, 'Picture duration differs from the locked film'
    assert abs(audio_seconds-expected_duration) <= .1, 'Narration stream is missing or cut short'
    assert int(video['nb_frames']) == math.ceil(expected_duration*30), 'Encoded frames are missing'
    return {'width': width, 'height': height, 'fps': 30, 'frames': int(video['nb_frames']),
            'picture_seconds': picture_seconds, 'audio_seconds': audio_seconds,
            'video_codec': video['codec_name'], 'audio_codec': audio['codec_name']}


def parse_loudness(stderr):
    blocks = re.findall(r'\{\s*"input_i"[\s\S]*?\}', stderr)
    assert len(blocks) == 1, 'No unambiguous measured audio summary'
    raw = json.loads(blocks[0])
    values = {key: float(raw[key]) for key in ('input_i','input_tp','input_lra')}
    assert all(math.isfinite(value) for value in values.values()), 'Silent or invalid narration measurement'
    assert values['input_tp'] <= -1, 'Narration exceeds the -1dBTP delivery ceiling'
    return {'integrated_lufs': values['input_i'], 'true_peak_dbtp': values['input_tp'],
            'loudness_range_lu': values['input_lra']}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('movie', type=Path)
    parser.add_argument('--resolution', choices=('3840x2160','1920x1080'), required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    movie = args.movie.resolve()
    assert movie.is_file() and movie.stat().st_size > 0, 'No completed export exists'
    project = Path(__file__).resolve().parents[1]
    expected = sum(v['duration_s'] for v in json.loads((project/'audio_meta.json').read_text())['voices'])
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(movie)],text=True))
    width, height = map(int, args.resolution.split('x'))
    report = validate_probe(probe, width, height, expected)
    # Decode every packet/frame. Do not replace a failed decode with metadata
    # success or trust the presence of a partly written output file.
    subprocess.run(['ffmpeg','-v','error','-xerror','-i',str(movie),'-f','null','-'],check=True)
    measured = subprocess.run(['ffmpeg','-hide_banner','-i',str(movie),'-vn','-af',
        'loudnorm=I=-18:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    report.update(parse_loudness(measured.stderr))
    report.update(file=movie.name,bytes=movie.stat().st_size,full_decode=True,
                  limits='Codec/duration/decode/loudness measurements; perceptual listening and visual review are separate.')
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps(report))


if __name__ == '__main__': main()
