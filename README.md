# Hundred Days

Two people, 100 days, one post each per day.

- **Bobby** posts a melodic hook (made in Ableton).
- **Jason** posts a bass line (voice memo from the phone is fine).

Site: **https://bomatson.github.io/hundred-days/**
Start date: **2026-10-20** (day 1). Day 100 is 2027-01-27.

## Rules

1. Post one new thing every day, made that day. Rough is fine. 15 to 60 seconds.
2. Post by midnight your local time.
3. A missed day is a gap, not a reset. The count keeps going. Do not miss two in a row.
4. Listen to the other person's post and leave a comment on it (GitHub Discussions, text, whatever).
5. The site shows a 100-cell grid per person: posted, missed, upcoming. Keep the grid full.

## How to post from your phone (Jason)

1. Record the bass line in Voice Memos. Share it to Files so you can find it, or share straight from Voice Memos in step 4.
2. Open **https://github.com/bomatson/hundred-days/upload/main/audio** in Safari.
   Log in to GitHub if asked.
3. Tap **choose your files** and pick the recording.
4. Before you commit, the file needs the right name. GitHub does not let you rename on upload, so rename the file in the Files app first:

   ```
   day-NNN-jason.m4a
   ```

   `NNN` is the day number with three digits: `day-001-jason.m4a`, `day-012-jason.m4a`, `day-100-jason.m4a`.
   The site header says **"Today is day N"**. Use that number.
5. Tap **Commit changes**. The site updates about a minute later.

Optional: add a note. Upload a text file named `day-NNN-jason.md` next to the audio. One line is enough: key, tempo, what you were going for.

Formats that work: `.m4a` (Voice Memos default), `.mp3`, `.wav`, `.caf`, `.ogg`. No conversion needed.

### Day number formula

Day = (today − 2026-10-20) + 1. Or just read it off the site header.

## How to post from the Mac (Bobby)

Export the hook from Ableton to the Desktop (WAV or MP3). Then in Claude Code, from this repo:

```
/post            # stages the newest audio file on the Desktop as today's post
/post --note "F minor, 140, pluck + sub"
```

Or run the script directly:

```
python3 scripts/post.py stage ~/Desktop/hook.wav --note "F minor, 140"
python3 scripts/post.py send
```

`stage` converts WAV to 320 kbps MP3, names it `audio/day-NNN-bobby.mp3`, writes the note, and commits on a branch `post/day-NNN-bobby`. Nothing leaves the machine yet.
`send` pushes the branch, opens a PR, and sets it to auto-merge once the build check passes. The site updates about a minute after the merge.
`status` shows today's day number and what is staged. `undo` drops a staged post.

## File naming

```
audio/day-NNN-<who>.<ext>    the audio   (NNN = 001..100, who = bobby | jason)
audio/day-NNN-<who>.md       optional one-line note
```

Files that do not match the pattern are ignored by the build and listed as warnings in the Action log.

## How the site works

- `challenge.json` holds the start date, day count, and participants.
- `scripts/build.py` scans `audio/`, writes `posts.json`, and copies `site/` plus `audio/` into `_site/`.
- `site/streaks.js` computes current streak, longest streak, and the grid in the browser from `posts.json` and today's date.
- `.github/workflows/pages.yml` runs the tests, builds, and deploys to GitHub Pages on every push to `main`. PRs run the tests and build as a check.

Run it locally:

```
python3 -m unittest discover -s scripts -p "test_*.py"
node --test site/streaks.test.js
python3 scripts/build.py && python3 -m http.server -d _site 8000
```

Then open http://localhost:8000.

## Sizes

A 30-second MP3 at 320 kbps is about 1.2 MB. A 30-second voice memo is about 0.3 MB. 200 posts fit in well under 300 MB, under GitHub's 1 GB repo guidance. Keep WAVs out of the repo (the `.gitignore` blocks them outside `audio/`).
