from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

path = Path(__file__).with_name("prepare-caption-meta.py")
spec = importlib.util.spec_from_file_location("caption_meta", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class CaptionOrderTests(unittest.TestCase):
    def setUp(self):
        self.meta = {"voices": [{"frame": 3, "duration_s": 4, "words": [
            {"text": "browser", "start": 1, "end": 1.3},
            {"text": "reads", "start": 1.3, "end": 1.7},
            {"text": "the", "start": 1.2, "end": 1.8},
            {"text": "code", "start": 1.8, "end": 2},
        ]}]}
        self.scenes = [{"frame": 3, "text": "browser reads the code"}]

    def test_regressing_asr_cannot_reorder_words_or_mutate_raw(self):
        before = deepcopy(self.meta)
        out = module.prepare(self.meta, self.scenes)
        words = sorted(out["voices"][0]["words"], key=lambda w: w["start"])
        self.assertEqual(" ".join(w["text"] for w in words), self.scenes[0]["text"])
        self.assertEqual(self.meta, before)
        self.assertEqual(len(out["caption_timing"]["adjustments"]), 1)

    def test_wrong_transcript_is_rejected(self):
        self.meta["voices"][0]["words"][1]["text"] = "deletes"
        with self.assertRaises(ValueError): module.prepare(self.meta, self.scenes)

    def test_out_of_chapter_timestamp_is_rejected(self):
        self.meta["voices"][0]["words"][-1]["end"] = 9
        with self.assertRaises(ValueError): module.prepare(self.meta, self.scenes)

if __name__ == "__main__": unittest.main()
