#!/usr/bin/env python3
"""Queue and send a daily post from this machine.

  python3 scripts/post.py stage [AUDIO_FILE] [--note TEXT] [--day N] [--who ID]
      Convert the file to MP3 if needed, name it day-NNN-<who>.mp3, write the
      note, and commit it on a branch post/day-NNN-<who>. Nothing is pushed.
      Without AUDIO_FILE it picks the newest audio file on ~/Desktop from the
      last 24 hours.
  python3 scripts/post.py send
      Push the staged branch, open a PR, and turn on auto-merge. The site
      rebuilds when the PR merges.
  python3 scripts/post.py status
      Show what is staged and what day it is.
  python3 scripts/post.py undo
      Drop the staged branch and go back to main.
"""
import argparse
import datetime as dt
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_EXTS = {".wav", ".aif", ".aiff", ".mp3", ".m4a", ".flac", ".ogg", ".caf"}
KEEP_AS_IS = {".mp3", ".m4a"}


def sh(*args, check=True, cwd=ROOT):
    r = subprocess.run(args, cwd=cwd, text=True, capture_output=True, check=False)
    if check and r.returncode != 0:
        sys.exit(f"error: {' '.join(args)}\n{(r.stderr or r.stdout).strip()}")
    return (r.stdout or "").strip()


def config():
    return json.loads((ROOT / "challenge.json").read_text())


def compute_day(start_date: str, today: dt.date) -> int:
    start = dt.date.fromisoformat(start_date)
    return (today - start).days + 1


def target_name(day: int, who: str, ext: str) -> str:
    return f"day-{day:03d}-{who}{ext.lower()}"


def pick_newest(folder: Path, hours: float = 24, now: float | None = None) -> Path | None:
    now = now or dt.datetime.now().timestamp()
    cands = [p for p in folder.iterdir()
             if p.is_file() and p.suffix.lower() in AUDIO_EXTS and now - p.stat().st_mtime <= hours * 3600]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def current_branch() -> str:
    return sh("git", "rev-parse", "--abbrev-ref", "HEAD")


def staged_branch() -> str | None:
    b = current_branch()
    return b if b.startswith("post/") else None


def cmd_stage(a):
    cfg = config()
    ids = [p["id"] for p in cfg["participants"]]
    if a.who not in ids:
        sys.exit(f"error: --who must be one of {ids}")
    day = a.day or compute_day(cfg["start_date"], dt.date.today())
    if day < 1:
        sys.exit(f"error: the challenge starts {cfg['start_date']}; today is day {day}. Use --day to override.")
    if day > cfg["days"]:
        sys.exit(f"error: day {day} is past the {cfg['days']}-day challenge. Use --day to override.")

    src = Path(a.file).expanduser() if a.file else pick_newest(Path.home() / "Desktop")
    if not src or not src.exists():
        sys.exit("error: no audio file given and nothing new on ~/Desktop in the last 24 h.")
    if src.suffix.lower() not in AUDIO_EXTS:
        sys.exit(f"error: {src.name} is not an audio file I know ({sorted(AUDIO_EXTS)})")

    if staged_branch():
        sys.exit(f"error: a post is already staged on {current_branch()}. Run 'send' or 'undo' first.")
    if sh("git", "status", "--porcelain"):
        sys.exit("error: working tree is not clean. Commit or stash first.")

    has_origin = "origin" in sh("git", "remote").split()
    if has_origin:
        sh("git", "fetch", "-q", "origin", "main")
        base = "origin/main"
    else:
        base = "main"
    branch = f"post/day-{day:03d}-{a.who}"
    sh("git", "checkout", "-q", "-B", branch, base)

    ext = src.suffix.lower() if src.suffix.lower() in KEEP_AS_IS else ".mp3"
    dest = ROOT / "audio" / target_name(day, a.who, ext)
    if dest.exists() and not a.force:
        sys.exit(f"error: {dest.name} already exists. Use --force to replace it.")
    if ext == src.suffix.lower():
        shutil.copy2(src, dest)
    else:
        if not shutil.which("ffmpeg"):
            sys.exit("error: ffmpeg not found (brew install ffmpeg)")
        sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
           "-codec:a", "libmp3lame", "-b:a", "320k", "-ar", "44100", str(dest))
    note_path = ROOT / "audio" / f"day-{day:03d}-{a.who}.md"
    if a.note:
        note_path.write_text(a.note.strip() + "\n")
    sh("git", "add", "audio/")
    sh("git", "commit", "-q", "-m", f"Day {day:03d}: {a.who}" + (f" - {a.note.strip()}" if a.note else ""))
    size = dest.stat().st_size / 1e6
    print(f"staged day {day} for {a.who}: audio/{dest.name} ({size:.1f} MB) on branch {branch}")
    if a.note:
        print(f"note: {a.note.strip()}")
    print("next: python3 scripts/post.py send")


def cmd_send(a):
    branch = staged_branch()
    if not branch:
        sys.exit("error: nothing staged. Run 'stage' first.")
    if "origin" not in sh("git", "remote").split():
        sys.exit("error: no 'origin' remote.")
    sh("git", "push", "-q", "-u", "origin", branch)
    title = sh("git", "log", "-1", "--format=%s")
    url = sh("gh", "pr", "create", "--base", "main", "--head", branch, "--title", title,
             "--body", "Daily post. Auto-merges when the build check passes.")
    sh("gh", "pr", "merge", branch, "--auto", "--squash", "--delete-branch")
    sh("git", "checkout", "-q", "main")
    print(f"sent: {url}")
    print("the site updates about a minute after the PR merges.")


def cmd_status(a):
    cfg = config()
    day = compute_day(cfg["start_date"], dt.date.today())
    print(f"today is day {day} of {cfg['days']} (start {cfg['start_date']})")
    b = staged_branch()
    if b:
        files = sh("git", "diff", "--name-only", "main...HEAD")
        print(f"staged on {b}:\n  " + files.replace("\n", "\n  "))
        print("next: python3 scripts/post.py send   (or undo)")
    else:
        print("nothing staged")
    newest = pick_newest(Path.home() / "Desktop")
    if newest:
        print(f"newest audio on Desktop: {newest.name}")


def cmd_undo(a):
    b = staged_branch()
    if not b:
        sys.exit("error: nothing staged.")
    sh("git", "checkout", "-q", "main")
    sh("git", "branch", "-D", b)
    print(f"dropped {b}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("stage")
    s.add_argument("file", nargs="?")
    s.add_argument("--note", default="")
    s.add_argument("--day", type=int)
    s.add_argument("--who", default=os.environ.get("HUNDRED_DAYS_WHO", "bobby"))
    s.add_argument("--force", action="store_true")
    s.set_defaults(fn=cmd_stage)
    sub.add_parser("send").set_defaults(fn=cmd_send)
    sub.add_parser("status").set_defaults(fn=cmd_status)
    sub.add_parser("undo").set_defaults(fn=cmd_undo)
    args = ap.parse_args()
    args.fn(args)
