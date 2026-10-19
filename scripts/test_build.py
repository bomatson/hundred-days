import datetime as dt
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build  # noqa: E402
import post  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent


class BuildTests(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        shutil.copy(ROOT / "challenge.json", self.tmp / "challenge.json")
        shutil.copytree(ROOT / "site", self.tmp / "site")
        (self.tmp / "audio").mkdir()
        for name in ["day-001-bobby.mp3", "day-001-jason.m4a", "day-002-jason.m4a",
                     "day-003-nobody.mp3", "random.mp3", ".gitkeep"]:
            (self.tmp / "audio" / name).write_bytes(b"\x00" * 10)
        (self.tmp / "audio" / "day-001-bobby.md").write_text("F minor, 140\n")

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_build_scans_named_files_only(self):
        data = build.build(self.tmp, self.tmp / "_site")
        posts = data["posts"]
        self.assertEqual([(p["day"], p["who"]) for p in posts],
                         [(1, "bobby"), (1, "jason"), (2, "jason")])
        self.assertEqual(posts[0]["note"], "F minor, 140")
        self.assertEqual(posts[1]["mime"], "audio/mp4")
        out = self.tmp / "_site"
        self.assertTrue((out / "index.html").exists())
        self.assertTrue((out / "streaks.js").exists())
        self.assertTrue((out / "audio" / "day-001-bobby.mp3").exists())
        self.assertFalse((out / "audio" / "day-001-bobby.md").exists())
        self.assertEqual(json.loads((out / "posts.json").read_text())["days"], 100)


class PostHelperTests(unittest.TestCase):
    def test_compute_day(self):
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 20)), 1)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 19)), 0)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2027, 1, 27)), 100)

    def test_target_name(self):
        self.assertEqual(post.target_name(7, "bobby", ".MP3"), "day-007-bobby.mp3")

    def test_pick_newest_respects_window_and_type(self):
        tmp = Path(tempfile.mkdtemp())
        try:
            now = 1_000_000.0
            old = tmp / "old.wav"; old.write_bytes(b"x"); os.utime(old, (now - 90000, now - 90000))
            txt = tmp / "new.txt"; txt.write_bytes(b"x"); os.utime(txt, (now, now))
            new = tmp / "hook.wav"; new.write_bytes(b"x"); os.utime(new, (now - 60, now - 60))
            self.assertEqual(post.pick_newest(tmp, now=now), new)
        finally:
            shutil.rmtree(tmp)


if __name__ == "__main__":
    unittest.main()
