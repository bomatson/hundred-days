import datetime as dt
import os
import shutil
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import post  # noqa: E402


class PostTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_compute_day(self):
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 20)), 1)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 21)), 2)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2027, 1, 27)), 100)

    def test_target_name(self):
        self.assertEqual(post.target_name(2, "bobby", ".WAV"), "day-002-bobby.wav")

    def test_day_url_from_staged_branch(self):
        cfg = {"site_url": "https://bomatson.github.io/hundred-days/"}
        self.assertEqual(post.day_url(cfg, "post/day-009-bobby"), "https://bomatson.github.io/hundred-days/day/9/")
        self.assertEqual(post.day_url(cfg, "post/day-100-drew"), "https://bomatson.github.io/hundred-days/day/100/")
        self.assertIsNone(post.day_url(cfg, "main"))
        self.assertIsNone(post.day_url({}, "post/day-009-bobby"))

    def test_sidecar_note_reads_md_then_txt(self):
        wav = self.tmp / "Hook 002 Neon Stairs.wav"
        wav.write_bytes(b"\x00")
        self.assertEqual(post.sidecar_note(wav), "")
        (self.tmp / "Hook 002 Neon Stairs.txt").write_text("from txt\n")
        self.assertEqual(post.sidecar_note(wav), "from txt")
        (self.tmp / "Hook 002 Neon Stairs.md").write_text('Hook 002 "Neon Stairs": A minor, 128 BPM.\n\n')
        self.assertEqual(post.sidecar_note(wav), 'Hook 002 "Neon Stairs": A minor, 128 BPM.')

    def test_sidecar_note_ignores_a_folder_with_the_same_name(self):
        wav = self.tmp / "hook.wav"
        wav.write_bytes(b"\x00")
        (self.tmp / "hook.md").mkdir()
        self.assertEqual(post.sidecar_note(wav), "")

    def test_pick_newest_skips_notes_and_old_files(self):
        old = self.tmp / "old.wav"
        old.write_bytes(b"\x00")
        two_days_ago = time.time() - 48 * 3600
        os.utime(old, (two_days_ago, two_days_ago))
        (self.tmp / "hook.md").write_text("note")
        self.assertIsNone(post.pick_newest(self.tmp))
        new = self.tmp / "hook.wav"
        new.write_bytes(b"\x00")
        self.assertEqual(post.pick_newest(self.tmp), new)


if __name__ == "__main__":
    unittest.main()
