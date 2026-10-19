# Hundred Days

Three people, 100 days, one post each per day.

- **Bobby** posts a melodic hook (made in Ableton).
- **Jason** posts a bass line (voice memo from the phone is fine).
- **Drew** posts a vocal take (voice memo from the phone is fine).

Site: **https://bomatson.github.io/hundred-days/**
Post from a phone: **https://bomatson.github.io/hundred-days/upload/**
Start date: **2026-10-20** (day 1). Day 100 is 2027-01-27.

## Rules

1. Post one new thing every day, made that day. Rough is fine. 15 to 60 seconds.
2. Post by midnight your local time.
3. A missed day is a gap, not a reset. The count keeps going. Do not miss two in a row.
4. Listen to the other person's post and leave a comment on it (GitHub Discussions, text, whatever).
5. The site shows a 100-cell grid per person: posted, missed, upcoming. Keep the grid full.

## How to post from your phone (Jason and Drew)

Open **https://bomatson.github.io/hundred-days/upload/** on your phone. Add it to your home screen if you like.

1. Type your passcode (Bobby gives you one). The page says "Posting as Jason" or "Posting as Drew". It remembers the passcode on that phone.
2. Tap **Choose a voice memo** and pick the recording. In Voice Memos: tap the memo, tap share, then **Save to Files** first if the picker does not show it.
3. Check the day. It defaults to today.
4. Add a one-line note if you want. Tap **Post day N as ...**.

The file lands in the repo under your name and the site updates about a minute later. If you already posted that day, the page asks whether to replace it.

Formats that work: `.m4a` (Voice Memos default), `.mp3`, `.wav`, `.caf`, `.ogg`, `.aif`. Max 25 MB. No conversion needed.

### Manual way (no passcode)

Upload straight to GitHub at **https://github.com/bomatson/hundred-days/upload/main/audio**. Name the file `day-NNN-jason.m4a` or `day-NNN-drew.m4a` first, where `NNN` is the day number with three digits (`day-001`, `day-012`, `day-100`). The site header says which day it is.

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
audio/day-NNN-<who>.<ext>    the audio   (NNN = 001..100, who = bobby | jason | drew)
audio/day-NNN-<who>.md       optional one-line note
```

Files that do not match the pattern are ignored by the build and listed as warnings in the Action log.

## How the site works

- `challenge.json` holds the start date, day count, and participants.
- `scripts/build.py` scans `audio/`, writes `posts.json`, and copies `site/` plus `audio/` into `_site/`.
- `site/streaks.js` computes current streak, longest streak, and the grid in the browser from `posts.json` and today's date.
- `.github/workflows/pages.yml` runs the tests, builds, and deploys to GitHub Pages on every push to `main`. PRs run the tests and build as a check.
- `site/upload/` is the phone upload page. It posts to the Cloudflare Worker in `worker/`, which checks the passcode, works out who is posting, and commits the file to `audio/` through the GitHub API. The Worker URL lives in `challenge.json` as `upload_endpoint`.

## Upload Worker (one-time setup)

The Worker runs on Cloudflare's free plan. From `worker/`:

```
npx wrangler login                       # opens the browser once
npx wrangler secret put GITHUB_TOKEN     # fine-grained PAT: this repo only, Contents: read and write
npx wrangler secret put PASSCODES        # {"bobby":"...","jason":"...","drew":"..."}
npx wrangler deploy                      # prints the Worker URL
```

Then put the Worker URL in `challenge.json` as `upload_endpoint`, commit, and the page switches on. Give each person their own passcode; the passcode is what tells the Worker who posted.

Make the PAT at https://github.com/settings/personal-access-tokens/new: repository access = only `hundred-days`, permission = Contents: read and write, expiry = after day 100.

Run the Worker tests with `node --test worker/test.mjs`. Run it locally with `npx wrangler dev` in `worker/`.

Run it locally:

```
python3 -m unittest discover -s scripts -p "test_*.py"
node --test site/streaks.test.js worker/test.mjs
python3 scripts/build.py && python3 -m http.server -d _site 8000
```

Then open http://localhost:8000.

## Sizes

A 30-second MP3 at 320 kbps is about 1.2 MB. A 30-second voice memo is about 0.3 MB. 300 posts fit in well under 300 MB, under GitHub's 1 GB repo guidance. Keep WAVs out of the repo (the `.gitignore` blocks them outside `audio/`).
