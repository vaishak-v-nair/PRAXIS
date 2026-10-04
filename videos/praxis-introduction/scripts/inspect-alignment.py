import json
from pathlib import Path
project = Path(__file__).resolve().parents[1]
scenes = json.loads((project / 'revision-scenes.json').read_text())
words = json.loads((project / 'assets/voice-v2/transcript-chunks.json').read_text())['words']
cursor = 0
for scene in scenes:
    end = cursor + len(scene['text'].split())
    selected = words[cursor:end]
    print(scene['frame'], selected[0], selected[-1])
    for i, w in enumerate(selected):
        if w['end'] < w['start'] or (i and w['start'] < selected[i-1]['end']):
            print('overlap', w, selected[i-1])
    cursor = end
