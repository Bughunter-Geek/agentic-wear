import unittest
from unittest.mock import Mock, patch
import phonon_worker as worker

class PhononProtocolTest(unittest.TestCase):
    def test_rejects_bad_id_and_mime_before_decoding(self):
        with patch.object(worker, 'decode_audio') as decode:
            for payload in [[], {}, {'id': 'x', 'audioBase64': 'aaaa', 'mimeType': 'audio/wav'}]:
                with self.assertRaises(ValueError):
                    worker.transcribe_request(payload, Mock(), '/unused')
            decode.assert_not_called()

    def test_preserves_request_id_and_bounds_text(self):
        speech = Mock()
        speech.transcribe_array_detailed.return_value.triple.return_value = (' a' * 13000, 0.1, 1)
        with patch.object(worker, 'decode_audio', return_value=object()):
            result = worker.transcribe_request({'id': 'request-1', 'audioBase64': 'audio', 'mimeType': 'audio/aac'}, speech, '/unused')
        self.assertEqual(result['id'], 'request-1')
        self.assertEqual(len(result['text']), worker.MAX_TEXT_LENGTH)

    def test_rejects_empty_transcript(self):
        speech = Mock()
        speech.transcribe_array_detailed.return_value.triple.return_value = (' ', 0.1, 1)
        with patch.object(worker, 'decode_audio', return_value=object()):
            with self.assertRaises(ValueError):
                worker.transcribe_request({'id':'r', 'audioBase64':'audio'}, speech, '/unused')

if __name__ == '__main__': unittest.main()
