import contextlib
import datetime as dt
import io
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import build  # noqa: E402
import post  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
LAST = dt.date(2027, 1, 27)   # day 100: nothing is held back


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
        data = build.build(self.tmp, self.tmp / "_site", today=LAST)
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
        self.assertIsNone(posts[0]["peaks"], "garbage bytes must not produce a waveform")

    def test_build_writes_one_page_per_day(self):
        build.build(self.tmp, self.tmp / "_site", today=LAST)
        out = self.tmp / "_site"
        self.assertFalse((out / "day.html").exists(), "the raw template must not ship")
        self.assertTrue((out / "day" / "1" / "index.html").exists())
        self.assertTrue((out / "day" / "100" / "index.html").exists())
        self.assertFalse((out / "day" / "0").exists())
        self.assertFalse((out / "day" / "101").exists())

        first = (out / "day" / "1" / "index.html").read_text()
        self.assertIn("<title>Day 1 · Hundred Days</title>", first)
        self.assertIn('<html lang="en" data-root="../../">', first)
        self.assertIn('<link rel="canonical" href="https://bomatson.github.io/hundred-days/day/1/">', first)
        self.assertIn('content="https://bomatson.github.io/hundred-days/og.png"', first)
        self.assertIn("Bobby: F minor, 140 · Jason posted a bass line.", first)
        self.assertIn("Tuesday, October 20, 2026", first)
        self.assertIn("const DAY = 1;", first)
        self.assertIn('href="../2/"', first)
        self.assertNotIn('href="../0/"', first)
        self.assertNotIn("{{", first)

        last = (out / "day" / "100" / "index.html").read_text()
        self.assertIn("Wednesday, January 27, 2027", last)
        self.assertIn('href="../99/"', last)
        self.assertNotIn('href="../101/"', last)

        quiet = (out / "day" / "3" / "index.html").read_text()   # day 3 only had a skipped file
        self.assertIn("Day 3 of 100. Nothing posted yet.", quiet)

    def test_build_holds_posts_for_days_after_today(self):
        # day 1: the day-2 post is in the repo but not on the site yet
        data = build.build(self.tmp, self.tmp / "_site", today=dt.date(2026, 10, 20))
        self.assertEqual([(p["day"], p["who"]) for p in data["posts"]], [(1, "bobby"), (1, "jason")])
        out = self.tmp / "_site"
        shipped = json.loads((out / "posts.json").read_text())["posts"]
        self.assertEqual([(p["day"], p["who"]) for p in shipped], [(1, "bobby"), (1, "jason")])
        self.assertTrue((out / "audio" / "day-001-jason.m4a").exists())
        self.assertFalse((out / "audio" / "day-002-jason.m4a").exists(), "a held post's audio must not ship")
        self.assertIn("Day 2 of 100. Nothing posted yet.", (out / "day" / "2" / "index.html").read_text())
        self.assertIn("Jason posted a bass line.", (out / "day" / "1" / "index.html").read_text())
        # day 2: it is out
        data = build.build(self.tmp, self.tmp / "_site", today=dt.date(2026, 10, 21))
        self.assertIn((2, "jason"), [(p["day"], p["who"]) for p in data["posts"]])
        self.assertTrue((out / "audio" / "day-002-jason.m4a").exists())
        self.assertIn("Jason posted a bass line.", (out / "day" / "2" / "index.html").read_text())
        # before the start: everything is held
        data = build.build(self.tmp, self.tmp / "_site", today=dt.date(2026, 10, 1))
        self.assertEqual(data["posts"], [])

    def test_build_reports_held_posts(self):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            build.build(self.tmp, self.tmp / "_site", today=dt.date(2026, 10, 20))
        self.assertIn("built 2 posts", buf.getvalue())
        self.assertIn("held 1 for later (today is day 1): day 2 jason (Wed Oct 21)", buf.getvalue())

    def test_today_in_uses_the_challenge_timezone(self):
        cfg = {"timezone": "America/New_York"}
        utc = dt.timezone.utc
        self.assertEqual(build.today_in(cfg, dt.datetime(2026, 11, 10, 4, 59, tzinfo=utc)), dt.date(2026, 11, 9))
        self.assertEqual(build.today_in(cfg, dt.datetime(2026, 11, 10, 5, 1, tzinfo=utc)), dt.date(2026, 11, 10))
        self.assertEqual(build.today_in({}, dt.datetime(2026, 11, 10, 4, 59, tzinfo=utc)), dt.date(2026, 11, 10))
        self.assertEqual(build.day_number({"start_date": "2026-10-20"}, dt.date(2026, 11, 10)), 22)
        self.assertEqual(build.day_date({"start_date": "2026-10-20"}, 22), dt.date(2026, 11, 10))

    def test_day_description_escapes_and_truncates(self):
        cfg = json.loads((ROOT / "challenge.json").read_text())
        posts = [{"who": "bobby", "note": 'A "quoted" <note> & more'}, {"who": "drew", "note": ""}]
        self.assertEqual(build.day_description(cfg, posts, 4), 'Bobby: A "quoted" <note> & more · Drew posted a vocal take.')
        self.assertEqual(build.render_day("{{DESCRIPTION}}", cfg, posts, 4),
                         "Bobby: A &quot;quoted&quot; &lt;note&gt; &amp; more · Drew posted a vocal take.")
        long = [{"who": "bobby", "note": "word " * 100}]
        desc = build.day_description(cfg, long, 4)
        self.assertLessEqual(len(desc), build.MAX_DESC)
        self.assertTrue(desc.endswith("word…"))

    def test_render_day_falls_back_to_the_default_site_url(self):
        cfg = {**json.loads((ROOT / "challenge.json").read_text()), "site_url": ""}
        self.assertEqual(build.render_day("{{URL}}", cfg, [], 7), "https://bomatson.github.io/hundred-days/day/7/")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg not installed")
    def test_peaks_from_real_audio_and_cache(self):
        tone = self.tmp / "audio" / "day-009-bobby.mp3"
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1.5",
                        "-codec:a", "libmp3lame", "-b:a", "64k", str(tone)], check=True)
        data = build.build(self.tmp, self.tmp / "_site", today=LAST)
        post = next(p for p in data["posts"] if p["day"] == 9)
        self.assertEqual(len(post["peaks"]), build.PEAKS)
        self.assertAlmostEqual(post["duration"], 1.5, delta=0.15)
        self.assertEqual(max(post["peaks"]), 1.0)
        self.assertTrue(all(0 <= v <= 1 for v in post["peaks"]))
        cached = list((self.tmp / ".peaks-cache").glob("*.json"))
        self.assertEqual(len(cached), 1)
        # second build hits the cache even without ffmpeg
        real_which = shutil.which
        shutil.which = lambda name: None
        try:
            again = build.build(self.tmp, self.tmp / "_site", today=LAST)
        finally:
            shutil.which = real_which
        self.assertEqual(next(p for p in again["posts"] if p["day"] == 9)["peaks"], post["peaks"])


class PostHelperTests(unittest.TestCase):
    def test_compute_day(self):
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 20)), 1)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2026, 10, 19)), 0)
        self.assertEqual(post.compute_day("2026-10-20", dt.date(2027, 1, 27)), 100)

    def test_exports_at_192k(self):
        src = (ROOT / "scripts" / "post.py").read_text()
        self.assertIn('"-b:a", "192k"', src)
        self.assertNotIn("320k", src)

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
