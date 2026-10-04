import unittest
from subtitle_export import timestamp, webvtt


class SubtitleExportTests(unittest.TestCase):
    def test_observed_windows_and_literal_words_are_preserved(self):
        value = webvtt([{'start': 1.23, 'end': 2.456, 'text': 'Read <source> & test.'}], 3)
        self.assertIn('00:00:01.230 --> 00:00:02.456', value)
        self.assertIn('Read &lt;source&gt; &amp; test.', value)
        self.assertEqual(timestamp(3600.002), '01:00:00.002')

    def test_invalid_and_overlapping_cues_cannot_be_exported(self):
        for cues in ([], [{'start': 0, 'end': 4, 'text': 'outside'}],
                     [{'start': 0, 'end': 2, 'text': 'first'}, {'start': 1, 'end': 3, 'text': 'overlap'}],
                     [{'start': 0, 'end': .0001, 'text': 'vanishes'}],
                     [{'start': float('nan'), 'end': 1, 'text': 'invalid'}]):
            with self.assertRaises(ValueError):
                webvtt(cues, 3)


if __name__ == '__main__':
    unittest.main()
