from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('encoded_qa',Path(__file__).with_name('qa-encoded.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EncodedDeliveryTests(unittest.TestCase):
    def setUp(self):
        self.probe = {'streams':[
            {'codec_type':'video','codec_name':'h264','width':3840,'height':2160,
             'avg_frame_rate':'30/1','duration':'124.7','nb_frames':'3741'},
            {'codec_type':'audio','codec_name':'aac','duration':'124.69'}]}

    def test_valid_delivery_retains_measured_duration(self):
        self.assertEqual(module.validate_probe(self.probe,3840,2160,124.69)['picture_seconds'],124.7)

    def test_small_picture_wrong_cadence_and_missing_audio_are_rejected(self):
        for field,value in [('width',1920),('avg_frame_rate','24/1'),('duration','120'),('nb_frames','3700')]:
            probe = deepcopy(self.probe)
            probe['streams'][0][field] = value
            with self.subTest(field=field),self.assertRaises(AssertionError):
                module.validate_probe(probe,3840,2160,124.69)
        with self.assertRaises(AssertionError): module.validate_probe({'streams':self.probe['streams'][:1]},3840,2160,124.69)

    def test_clipping_or_absent_narration_cannot_pass(self):
        for summary in ['', '{"input_i":"-inf","input_tp":"-inf","input_lra":"0"}',
                        '{"input_i":"-18","input_tp":"0","input_lra":"2"}']:
            with self.subTest(summary=summary),self.assertRaises(AssertionError): module.parse_loudness(summary)
        self.assertEqual(module.parse_loudness('{"input_i":"-19.4","input_tp":"-1.5","input_lra":"2.5"}')['true_peak_dbtp'],-1.5)


if __name__ == '__main__': unittest.main()
