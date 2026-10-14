import importlib.util, tempfile, unittest
from pathlib import Path
spec = importlib.util.spec_from_file_location('promotion', Path(__file__).with_name('prepare-public-promotion.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
class PromotionGuards(unittest.TestCase):
    def test_unaccepted_private_artifact_cannot_be_promoted(self):
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root)/'app.apk'; apk.write_bytes(b'changed bytes')
            with self.assertRaisesRegex(ValueError, 'Physical Watch acceptance'):
                module.prepare(apk, {'private': True, 'published': True}, {'accepted': False}, 'v0.6.40-alpha', Path(root)/'out', Path(root))
    def test_modified_bytes_cannot_use_an_old_acceptance(self):
        with tempfile.TemporaryDirectory() as root:
            apk = Path(root)/'app.apk'; apk.write_bytes(b'changed bytes')
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                module.prepare(apk, {'private': True, 'published': True, 'sha256': 'a'*64},
                    {'accepted': True, 'physicalWatch': True, 'sha256': 'a'*64}, 'v0.6.40-alpha', Path(root)/'out', Path(root))
if __name__ == '__main__': unittest.main()
