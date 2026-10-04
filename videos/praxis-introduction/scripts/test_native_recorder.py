import struct
import unittest
from native_recorder import png_size, timed_frames


class NativeRecorderTests(unittest.TestCase):
    def test_native_size_comes_from_pixels_not_requested_output(self):
        png = b'\x89PNG\r\n\x1a\n' + struct.pack('>I', 13) + b'IHDR' + struct.pack('>II', 3840, 2160)
        self.assertEqual(png_size(png), (3840, 2160))
        with self.assertRaises(AssertionError):
            png_size(b'not a frame')

    def test_real_event_windows_retain_the_initial_frame_and_quiet_holds(self):
        frames = [{'file':'a.png','timestamp':99.5}, {'file':'b.png','timestamp':100.3}, {'file':'c.png','timestamp':101.2}]
        rows = timed_frames(frames, 100, 102)
        self.assertEqual([r['file'] for r, _ in rows], ['a.png', 'b.png', 'c.png'])
        self.assertAlmostEqual(sum(duration for _, duration in rows), 2)
        self.assertEqual(frames[0]['timestamp'], 99.5)

    def test_missing_initial_frame_or_regressed_timestamps_are_rejected(self):
        with self.assertRaises(AssertionError):
            timed_frames([{'timestamp':101}], 100, 102)
        with self.assertRaises(AssertionError):
            timed_frames([{'timestamp':99}, {'timestamp':98}], 100, 102)
        with self.assertRaises(AssertionError):
            timed_frames([], 100, 102)


if __name__ == '__main__':
    unittest.main()
