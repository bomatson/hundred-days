---
name: post
description: Queue and send today's Hundred Days post (Bobby's daily hook). Use when Bobby says /post, "post today's hook", "queue the hook", or "send the post". Stages the audio on a branch first, sends only when he says so.
---

# /post — queue today's hook

Repo: this one (`hundred-days`). Tool: `scripts/post.py`. Arguments: `$ARGUMENTS`.

## Steps

1. Run `python3 scripts/post.py status`. Report the day number and whether something is already staged.
2. Pick the audio file:
   - If `$ARGUMENTS` names a file, use it.
   - Else if the user named a file in chat, use it.
   - Else use the newest audio file on `~/Desktop` from the last 24 h (the script does this by default). Say which file it picked before you stage it.
3. Pick the note: use `--note` from `$ARGUMENTS` or from what the user said (key, BPM, sound). No note is fine.
4. Stage: `python3 scripts/post.py stage [FILE] [--note "..."]`. Show the output line that names the staged file and its size.
5. Stop and ask one short question: **"Send it?"** Do not send on your own.
6. When the user says yes / send / go: run `python3 scripts/post.py send`. Report the PR URL. The PR auto-merges after the build check passes and the site updates about a minute later.
7. If the user says no or wants a different file: run `python3 scripts/post.py undo`, then go back to step 2.

## Rules

- One staged post at a time. If `stage` says a post is already staged, show `status` and ask whether to send or undo it.
- Never commit on `main`. The script always works on a `post/day-NNN-bobby` branch.
- If the day number looks wrong (he is posting yesterday's hook after midnight), pass `--day N` explicitly. Ask first.
- Keep replies to one or two lines. This runs during music sessions.
