#!/usr/bin/env python3
"""Build the static site into _site/.

Scans audio/ for files named day-NNN-<participant>.<ext>, reads optional
day-NNN-<participant>.md notes, and writes _site/ with index.html, the
streak script, posts.json, a copy of audio/, and one page per day at
day/N/index.html (rendered from site/day.html) so a single day can be shared.

Usage: python3 scripts/build.py [--root REPO_ROOT] [--out _site]
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path

PEAKS = 160          # bars per waveform
PEAK_RATE = 8000     # Hz, mono, plenty for a silhouette
SITE_URL = "https://bomatson.github.io/hundred-days/"   # used when challenge.json has no site_url
MAX_DESC = 300       # characters in a day page's meta description
DAY_TEMPLATE = "day.html"

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


def peaks_for(path: Path, cache: Path) -> dict | None:
    """Return {"duration": s, "peaks": [0..1]*PEAKS} using ffmpeg, cached by name+size."""
    key = hashlib.sha1(f"{path.name}:{path.stat().st_size}:{PEAKS}:{PEAK_RATE}".encode()).hexdigest()
    hit = cache / f"{key}.json"
    if hit.exists():
        return json.loads(hit.read_text())
    if not shutil.which("ffmpeg"):
        return None
    r = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", str(path), "-ac", "1", "-ar", str(PEAK_RATE), "-f", "s16le", "-"],
        capture_output=True,
    )
    if r.returncode != 0 or len(r.stdout) < 2:
        return None
    n = len(r.stdout) // 2
    samples = struct.unpack(f"<{n}h", r.stdout[: n * 2])
    step = max(1, n // PEAKS)
    raw = []
    for i in range(PEAKS):
        chunk = samples[i * step:(i + 1) * step]
        raw.append(max((abs(x) for x in chunk), default=0))
    top = max(raw) or 1
    out = {"duration": round(n / PEAK_RATE, 2), "peaks": [round((v / top) ** 0.8, 2) for v in raw]}
    cache.mkdir(parents=True, exist_ok=True)
    hit.write_text(json.dumps(out))
    return out


def scan(root: Path) -> tuple[list[dict], list[str]]:
    audio = root / "audio"
    posts, warnings = [], []
    ids = {p["id"] for p in json.loads((root / "challenge.json").read_text())["participants"]}
    cache = root / ".peaks-cache"
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
        wave = peaks_for(f, cache)
        if wave is None:
            warnings.append(f"no waveform (ffmpeg failed or missing): audio/{f.name}")
        posts.append({
            "day": day,
            "who": who,
            "file": f"audio/{f.name}",
            "mime": MIME[ext],
            "bytes": f.stat().st_size,
            "note": note,
            "posted_at": git_date(root, f"audio/{f.name}"),
            "duration": wave["duration"] if wave else None,
            "peaks": wave["peaks"] if wave else None,
        })
    posts.sort(key=lambda p: (p["day"], p["who"]))
    return posts, warnings


def day_description(cfg: dict, posts: list[dict], day: int) -> str:
    """One line for a day page's link preview: who posted, with their notes."""
    parts = []
    for p in cfg["participants"]:
        post = next((x for x in posts if x["who"] == p["id"]), None)
        if post:
            parts.append(f"{p['name']}: {post['note']}" if post["note"] else f"{p['name']} posted {p['makes']}.")
    if not parts:
        return f"Day {day} of {cfg['days']}. Nothing posted yet."
    text = " · ".join(parts)
    if len(text) > MAX_DESC:
        text = text[: MAX_DESC - 1].rsplit(" ", 1)[0] + "…"
    return text


def render_day(template: str, cfg: dict, posts: list[dict], day: int) -> str:
    """Fill site/day.html for one day. The page loads posts.json and renders the players itself."""
    site_url = (cfg.get("site_url") or SITE_URL).rstrip("/") + "/"
    date = dt.date.fromisoformat(cfg["start_date"]) + dt.timedelta(days=day - 1)
    fills = {
        "DAY": str(day),
        "TOTAL": str(cfg["days"]),
        "DATE": f"{date:%A}, {date:%B} {date.day}, {date.year}",
        "DESCRIPTION": html.escape(day_description(cfg, posts, day), quote=True),
        "URL": f"{site_url}day/{day}/",
        "SITE_URL": site_url,
        "PREV": f'<a href="../{day - 1}/" rel="prev">&larr; Day {day - 1}</a>' if day > 1 else "<span></span>",
        "NEXT": f'<a href="../{day + 1}/" rel="next">Day {day + 1} &rarr;</a>' if day < cfg["days"] else "<span></span>",
    }
    out = re.sub(r"<!--.*?-->\n?", "", template, count=1, flags=re.S)   # the template's own comment
    for key, value in fills.items():
        out = out.replace("{{" + key + "}}", value)
    return out


def build(root: Path, out: Path) -> dict:
    cfg = json.loads((root / "challenge.json").read_text())
    posts, warnings = scan(root)
    data = {**cfg, "posts": posts}
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(root / "site", out, ignore=shutil.ignore_patterns(DAY_TEMPLATE))
    shutil.copytree(root / "audio", out / "audio", ignore=shutil.ignore_patterns(".gitkeep", "*.md"))
    (out / "posts.json").write_text(json.dumps(data, indent=2))
    (out / ".nojekyll").write_text("")
    template = (root / "site" / DAY_TEMPLATE).read_text()
    by_day: dict[int, list[dict]] = {}
    for p in posts:
        by_day.setdefault(p["day"], []).append(p)
    for day in range(1, cfg["days"] + 1):
        page_dir = out / "day" / str(day)
        page_dir.mkdir(parents=True)
        (page_dir / "index.html").write_text(render_day(template, cfg, by_day.get(day, []), day))
    for w in warnings:
        print(f"warning: {w}", file=sys.stderr)
    print(f"built {len(posts)} posts and {cfg['days']} day pages -> {out}")
    return data


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=Path(__file__).resolve().parent.parent)
    ap.add_argument("--out", default="_site")
    a = ap.parse_args()
    root = Path(a.root)
    build(root, root / a.out)
