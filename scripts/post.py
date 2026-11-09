#!/usr/bin/env python3
"""Queue and send a daily post from this machine.

  python3 scripts/post.py stage [AUDIO_FILE] [--note TEXT] [--day N] [--who ID]
      Convert the file to 192 kbps MP3 if needed, name it day-NNN-<who>.mp3, write the
      note, and commit it on a branch post/day-NNN-<who>. Nothing is pushed.
      --day N may be a later day: the site holds the post until that day comes.
      Without AUDIO_FILE it picks the newest audio file on ~/Desktop from the
      last 24 hours. Without --note it uses a sidecar note next to the audio
      file, if there is one: the same name with .md or .txt (hook.wav -> hook.md).
  python3 scripts/post.py send
      Push the staged branch, open a PR, and turn on auto-merge. The site
      rebuilds when the PR merges.
  python3 scripts/post.py status
      Show what is staged, what day it is, and which posts are held for later days.
  python3 scripts/post.py undo
      Drop the staged branch and go back to main.
"""
import argparse
import datetime as dt
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from zoneinfo import ZoneInfo

from build import AUDIO_RE   # the file names the site accepts: day-NNN-<who>.<ext>

ROOT = Path(__file__).resolve().parent.parent
BRANCH_RE = re.compile(r"post/day-(\d{3})-")
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


def day_date(start_date: str, day: int) -> dt.date:
    return dt.date.fromisoformat(start_date) + dt.timedelta(days=day - 1)


def held_note(start_date: str, day: int, today: dt.date) -> str:
    """One line when a post is for a day that has not come yet, else ""."""
    if day <= compute_day(start_date, today):
        return ""
    d = day_date(start_date, day)
    return f"day {day} is {d:%A, %b} {d.day}: the site holds this post until then."


def today(cfg: dict) -> dt.date:
    """Today on the challenge's calendar (challenge.json "timezone"): the same clock build.py uses."""
    return dt.datetime.now(ZoneInfo(cfg.get("timezone") or "UTC")).date()


def posts_in(audio: Path, ids: set[str] | None = None) -> set[tuple[int, str]]:
    """(day, who) for every audio file in audio/ that the build accepts, for the given participants (or all)."""
    found = set()
    for f in audio.iterdir():
        m = AUDIO_RE.match(f.name)
        if m and (ids is None or m.group(2).lower() in ids):
            found.add((int(m.group(1)), m.group(2).lower()))
    return found


def held_posts(audio: Path, today_day: int, ids: set[str] | None = None) -> list[tuple[int, str]]:
    """The posts in audio/ for days after today_day, in day order."""
    return sorted(p for p in posts_in(audio, ids) if p[0] > today_day)


def next_open_day(audio: Path, who: str, from_day: int, days: int) -> int | None:
    """The first day from from_day on with no post from who, or None when the rest are taken."""
    taken = {d for d, w in posts_in(audio) if w == who}
    return next((d for d in range(max(from_day, 1), days + 1) if d not in taken), None)


def pick_newest(folder: Path, hours: float = 24, now: float | None = None) -> Path | None:
    now = now or dt.datetime.now().timestamp()
    cands = [p for p in folder.iterdir()
             if p.is_file() and p.suffix.lower() in AUDIO_EXTS and now - p.stat().st_mtime <= hours * 3600]
    return max(cands, key=lambda p: p.stat().st_mtime) if cands else None


def sidecar_note(audio: Path) -> str:
    """The text of <audio stem>.md or .txt next to the audio file, or "" when there is none."""
    for ext in (".md", ".txt"):
        p = audio.with_suffix(ext)
        if p.is_file():
            return p.read_text().strip()
    return ""


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
    day = a.day or compute_day(cfg["start_date"], today(cfg))
    if day < 1:
        sys.exit(f"error: the challenge starts {cfg['start_date']}; today is day {day}. Use --day to override.")
    if day > cfg["days"]:
        sys.exit(f"error: day {day} is past the {cfg['days']}-day challenge. Use --day to override.")

    src = Path(a.file).expanduser() if a.file else pick_newest(Path.home() / "Desktop")
    if not src or not src.exists():
        sys.exit("error: no audio file given and nothing new on ~/Desktop in the last 24 h.")
    if src.suffix.lower() not in AUDIO_EXTS:
        sys.exit(f"error: {src.name} is not an audio file I know ({sorted(AUDIO_EXTS)})")
    note = a.note.strip() or sidecar_note(src)

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
    prev = current_branch()
    sh("git", "checkout", "-q", "-B", branch, base)

    ext = src.suffix.lower() if src.suffix.lower() in KEEP_AS_IS else ".mp3"
    dest = ROOT / "audio" / target_name(day, a.who, ext)
    if (day, a.who) in posts_in(ROOT / "audio") and not a.force:
        # back out, so the next stage does not find this empty branch "already staged"
        nxt = next_open_day(ROOT / "audio", a.who, day + 1, cfg["days"])
        sh("git", "checkout", "-q", prev)
        sh("git", "branch", "-q", "-D", branch)
        hint = f"Use --day {nxt} for the next open day, or --force to replace it." if nxt else "Use --force to replace it."
        sys.exit(f"error: day {day} already has a post from {a.who}. {hint}")
    if ext == src.suffix.lower():
        shutil.copy2(src, dest)
    else:
        if not shutil.which("ffmpeg"):
            sys.exit("error: ffmpeg not found (brew install ffmpeg)")
        sh("ffmpeg", "-y", "-loglevel", "error", "-i", str(src),
           "-codec:a", "libmp3lame", "-b:a", "192k", "-ar", "44100", str(dest))
    note_path = ROOT / "audio" / f"day-{day:03d}-{a.who}.md"
    if note:
        note_path.write_text(note + "\n")
    sh("git", "add", "audio/")
    sh("git", "commit", "-q", "-m", f"Day {day:03d}: {a.who}" + (f" - {note}" if note else ""))
    size = dest.stat().st_size / 1e6
    print(f"staged day {day} for {a.who}: audio/{dest.name} ({size:.1f} MB) on branch {branch}")
    if note:
        print(f"note: {note}")
    ahead = held_note(cfg["start_date"], day, today(cfg))
    if ahead:
        print(ahead)
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
    cfg = config()
    print(f"sent: {url}")
    m = BRANCH_RE.match(branch)
    day = int(m.group(1)) if m else 0
    ahead = held_note(cfg["start_date"], day, today(cfg)) if day else ""
    print(ahead or "the site updates about a minute after the PR merges.")
    link = day_url(cfg, branch)
    if link and ahead:
        d = day_date(cfg["start_date"], day)
        print(f"day page, share it on {d:%A, %b} {d.day} (a link shared early keeps an empty preview): {link}")
    elif link:
        print(f"day page to share: {link}")


def day_url(cfg: dict, branch: str) -> str | None:
    """The page for the day a post/day-NNN-<who> branch posts, or None for other branches."""
    m = BRANCH_RE.match(branch)
    if not m or not cfg.get("site_url"):
        return None
    return f"{cfg['site_url'].rstrip('/')}/day/{int(m.group(1))}/"


def cmd_status(a):
    cfg = config()
    day = compute_day(cfg["start_date"], today(cfg))
    print(f"today is day {day} of {cfg['days']} (start {cfg['start_date']})")
    ids = {p["id"] for p in cfg["participants"]}
    held = held_posts(ROOT / "audio", day, ids)
    if held:
        items = []
        for d, who in held:
            date = day_date(cfg["start_date"], d)
            items.append(f"day {d} {who} ({date:%a %b} {date.day})")
        print("held for later: " + ", ".join(items))
    nxt = next_open_day(ROOT / "audio", a.who, day, cfg["days"])
    if nxt and nxt != day:
        date = day_date(cfg["start_date"], nxt)
        print(f"next open day for {a.who}: {nxt} ({date:%a %b} {date.day}); stage with --day {nxt}")
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
    st = sub.add_parser("status")
    st.add_argument("--who", default=os.environ.get("HUNDRED_DAYS_WHO", "bobby"))
    st.set_defaults(fn=cmd_status)
    sub.add_parser("undo").set_defaults(fn=cmd_undo)
    args = ap.parse_args()
    args.fn(args)
