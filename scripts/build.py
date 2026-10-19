#!/usr/bin/env python3
"""Build the static site into _site/.

Scans audio/ for files named day-NNN-<participant>.<ext>, reads optional
day-NNN-<participant>.md notes, and writes _site/ with index.html, the
streak script, posts.json, and a copy of audio/.

Usage: python3 scripts/build.py [--root REPO_ROOT] [--out _site]
"""
import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

AUDIO_RE = re.compile(r"^day-(\d{3})-([a-z0-9]+)\.(mp3|m4a|wav|aif|aiff|ogg|caf)$", re.I)
MIME = {
    "mp3": "audio/mpeg", "m4a": "audio/mp4", "wav": "audio/wav",
    "aif": "audio/aiff", "aiff": "audio/aiff", "ogg": "audio/ogg", "caf": "audio/x-caf",
}


def git_date(root: Path, rel: str) -> str | None:
    try:
        out = subprocess.run(
            ["git", "log", "-1", "--format=%cI", "--", rel],
            cwd=root, capture_output=True, text=True, check=True,
        ).stdout.strip()
        return out or None
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def scan(root: Path) -> tuple[list[dict], list[str]]:
    audio = root / "audio"
    posts, warnings = [], []
    ids = {p["id"] for p in json.loads((root / "challenge.json").read_text())["participants"]}
    for f in sorted(audio.iterdir()):
        if f.name.startswith(".") or f.suffix.lower() == ".md":
            continue
        m = AUDIO_RE.match(f.name)
        if not m:
            warnings.append(f"skipped (bad name): audio/{f.name}")
            continue
        day, who, ext = int(m.group(1)), m.group(2).lower(), m.group(3).lower()
        if who not in ids:
            warnings.append(f"skipped (unknown participant '{who}'): audio/{f.name}")
            continue
        note_path = audio / f"day-{day:03d}-{who}.md"
        note = note_path.read_text().strip() if note_path.exists() else ""
        posts.append({
            "day": day,
            "who": who,
            "file": f"audio/{f.name}",
            "mime": MIME[ext],
            "bytes": f.stat().st_size,
            "note": note,
            "posted_at": git_date(root, f"audio/{f.name}"),
        })
    posts.sort(key=lambda p: (p["day"], p["who"]))
    return posts, warnings


def build(root: Path, out: Path) -> dict:
    cfg = json.loads((root / "challenge.json").read_text())
    posts, warnings = scan(root)
    data = {**cfg, "posts": posts}
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(root / "site", out)
    shutil.copytree(root / "audio", out / "audio", ignore=shutil.ignore_patterns(".gitkeep", "*.md"))
    (out / "posts.json").write_text(json.dumps(data, indent=2))
    (out / ".nojekyll").write_text("")
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    print(f"built {len(posts)} posts -> {out}")
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=Path(__file__).resolve().parent.parent)
    ap.add_argument("--out", default="_site")
    a = ap.parse_args()
    root = Path(a.root)
    build(root, root / a.out)
