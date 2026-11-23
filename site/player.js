// Shared page code: load posts.json, render a post row, run the waveform players,
// Shuffle all, and the Share button. Used by index.html (site root) and by day/N/index.html,
// which sets data-root="../../" on <html> so every URL still points at the site root.
(function () {
  const ROOT = document.documentElement.getAttribute("data-root") || "";
  const SPARE = ["#ff4d1c", "#1f4fff", "#8f3dff", "#00a870"];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (t) => isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––";

  async function load() {
    const res = await fetch(ROOT + "posts.json", { cache: "no-store" });
    const data = await res.json();
    library = tracks(data);
    return data;
  }

  // posts.json -> one track per post, oldest first. This is what Shuffle all plays.
  function tracks(data) {
    const c = colors(data);
    const people = new Map(data.participants.map((p) => [p.id, p]));
    return data.posts.filter((post) => people.has(post.who)).map((post) => {
      const p = people.get(post.who);
      return {
        file: post.file, day: post.day, who: post.who, color: c[post.who], duration: post.duration,
        title: `Day ${post.day} · ${p.name}`,
        sub: (post.note || "").replace(/\s+/g, " ").trim() || p.makes,
      };
    });
  }

  // participant id -> CSS color
  function colors(data) {
    const c = { bobby: "var(--hook)", jason: "var(--bass)", drew: "var(--vox)" };
    data.participants.forEach((p, i) => { if (!c[p.id]) c[p.id] = SPARE[i % SPARE.length]; });
    return c;
  }

  // (day, Intl options) -> formatted date of that day
  function dayDate(data) {
    return (d, opts) => new Date(Streaks.parseDate(data.start_date) + (d - 1) * 86400000)
      .toLocaleDateString(undefined, { timeZone: "UTC", ...opts });
  }

  // absolute URL of a day page, built from where this page is served
  function dayUrl(day) {
    return new URL(`${ROOT}day/${day}/`, location.href).href;
  }

  // the "Day 9 of 100" line in the top bar
  function topLine(data, todayDay) {
    const dd = dayDate(data);
    if (todayDay < 1) return `Starts <strong>${dd(1, { month: "short", day: "numeric" })}</strong>`;
    if (todayDay > data.days) return `<strong>Finished</strong>`;
    return `<strong>Day ${todayDay}</strong> of ${data.days}`;
  }

  function renderPost(p, post, day, color) {
    const note = post.note ? `<div class="note">${esc(post.note)}</div>` : "";
    return `
      <div class="post" style="--c:${color}" data-src="${esc(post.file)}" data-duration="${post.duration || ""}" data-peaks="${post.peaks ? post.peaks.join(",") : ""}">
        <button class="play" type="button" aria-label="Play ${esc(p.name)}, day ${day}">
          <svg class="ic-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>
          <svg class="ic-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>
        </button>
        <div>
          <div class="meta"><span class="nm">${esc(p.name)}</span><span>${esc(p.makes)}</span><span class="time">–:––</span><a class="dl" href="${ROOT}${esc(post.file)}" download title="Download" aria-label="Download ${esc(p.name)}, day ${day}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M7 1.5h2v6.7l2.6-2.6 1.4 1.4L8 12 3 7l1.4-1.4L7 8.2zM3 13h10v1.5H3z"/></svg></a></div>
          <div class="wave"><canvas></canvas><canvas class="prog"></canvas></div>
          ${note}
        </div>
      </div>`;
  }

  function renderEmpty(p, color, text) {
    return `<div class="post empty" style="--c:${color}"><div class="dot"></div><div>${esc(text)}</div></div>`;
  }

  // Rows for one day: a player for each post, an empty row for each participant without one.
  function renderDay(data, colors, posts, day, todayDay) {
    return data.participants.map((p) => {
      const post = posts.find((x) => x.who === p.id);
      if (post) return renderPost(p, post, day, colors[p.id]);
      const text = day === todayDay ? `${p.name} has not posted yet` : `${p.name} did not post`;
      return renderEmpty(p, colors[p.id], text);
    }).join("");
  }

  // ---- shuffle order ----

  // 0..n-1 in random order (Fisher-Yates). notFirst: an index that must not come first,
  // so a new round does not start with the track that just played.
  function shuffled(n, rand, notFirst) {
    const a = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    if (n > 1 && a[0] === notFirst) {
      const j = 1 + Math.floor(rand() * (n - 1));
      [a[0], a[j]] = [a[j], a[0]];
    }
    return a;
  }

  // Every track once in random order, then a new random order, with no end.
  function makeQueue(n, rand, notFirst) {
    rand = rand || Math.random;
    const order = shuffled(n, rand, notFirst);
    let pos = 0;
    return {
      current: () => order[pos],
      next() {
        if (pos === order.length - 1) order.push(...shuffled(n, rand, order[pos]));
        return order[++pos];
      },
      prev() { if (pos > 0) pos--; return order[pos]; },
      // the listener picked a track by hand: play it now, then go on with the order
      jump(i) { order.splice(pos + 1, 0, i); return order[++pos]; },
    };
  }

  // ---- playback ----
  //
  // One <audio> element plays everything on the page. A phone lets a page start audio
  // without a tap only on an element that a tap already started, so the next shuffled
  // track loads into the same element. That keeps Shuffle all going with the screen locked.
  // A post row is a view of that element while its file is the loaded one.

  let ctx = null;       // one AudioContext for the fallback decoder
  let audio = null;     // the one <audio>, made on the first play
  let now = null;       // the loaded track
  let queue = null;     // the shuffle order while Shuffle all is on, else null
  let bar = null;       // the shuffle bar at the bottom of the page, made on the first shuffle
  let failures = 0;     // tracks in a row that did not load
  let seekTo = null;    // 0..1, where to start once the loaded track knows its length
  let library = [];     // every released post as a track (see tracks)
  const rows = new Map();   // file -> the post row on this page
  const players = [];

  const go = (a) => { const p = a.play(); if (p && p.catch) p.catch(() => {}); };

  function engine() {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("loadedmetadata", () => {
      const row = now && rows.get(now.file);
      if (row) row.learn(audio.duration);
      if (seekTo !== null && isFinite(audio.duration)) audio.currentTime = seekTo * audio.duration;
      seekTo = null;
      paint();
    });
    audio.addEventListener("timeupdate", paint);
    audio.addEventListener("playing", () => { failures = 0; });
    audio.addEventListener("play", () => setPlaying(true));
    // a track that ends fires "pause" first: in a shuffle the next track follows, so stay "playing"
    audio.addEventListener("pause", () => { if (!(queue && audio.ended)) setPlaying(false); });
    audio.addEventListener("ended", () => {
      if (queue) { step(1); return; }
      setPlaying(false);
      rest(now);
    });
    audio.addEventListener("error", failed);
    return audio;
  }

  // progress and clock, on the row of the loaded track and on the shuffle bar
  function paint() {
    if (!now || !audio) return;
    const row = rows.get(now.file);
    const d = audio.duration || (row && row.duration()) || now.duration;
    const f = d ? Math.min(1, audio.currentTime / d) : 0;
    const text = `${fmt(audio.currentTime)} / ${fmt(d)}`;
    if (row) row.progress(f, text);
    if (bar) bar.progress(f, text);
  }

  function setPlaying(on) {
    const row = now && rows.get(now.file);
    if (row) row.el.classList.toggle("playing", on);
    if (bar) bar.playing(on);
  }

  // put a track's row back to its idle look
  function rest(track) {
    const row = track && rows.get(track.file);
    if (row) row.rest();
  }

  // Load a track into the one element and play it. at: 0..1, where to start.
  function start(track, at) {
    const a = engine();
    if (now && now.file !== track.file) rest(now);
    now = track;
    seekTo = at == null ? null : at;
    a.src = ROOT + track.file;
    announce(track);
    if (bar) bar.show(track);
    setPlaying(true);   // show it at once; the element reports back if it cannot play
    const p = a.play();
    if (p && p.catch) p.catch(() => { if (now === track && a.paused) setPlaying(false); });
  }

  // the loaded track did not load
  function failed() {
    if (!now) return;
    failures++;
    if (queue && failures < 3 && library.length > 1) { step(1); return; }   // skip one bad file, not a dead connection
    setPlaying(false);
    if (queue && bar) bar.warn("Could not load the audio. Press play to try again.");
  }

  function toggle() {
    if (!now) return;
    const a = engine();
    if (a.error) { failures = 0; start(now); return; }   // the last load failed: try it again
    if (a.paused) go(a); else a.pause();
  }

  // A press on a post row. at: 0..1 for a press on the waveform, else none (the play button).
  function press(file, at) {
    const a = engine();
    if (now && now.file === file && !a.error) {
      if (at == null) { toggle(); return; }
      if (isFinite(a.duration)) a.currentTime = at * a.duration; else seekTo = at;
      if (a.paused) go(a);
      return;
    }
    const i = library.findIndex((t) => t.file === file);
    if (queue && i >= 0) queue.jump(i);
    failures = 0;
    start(i >= 0 ? library[i] : { file, title: "", sub: "" }, at);
  }

  // next (1) or previous (-1) track of the shuffle
  function step(dir) {
    if (!queue) return;
    const a = engine();
    if (dir < 0 && a.currentTime > 3 && !a.error) { a.currentTime = 0; if (a.paused) go(a); return; }   // Previous goes to the start of the track first
    start(library[dir < 0 ? queue.prev() : queue.next()]);
  }

  // Shuffle all: play every track in random order, with no end, until the listener stops it.
  function shuffle() {
    if (!library.length) return;
    const playing = now ? library.findIndex((t) => t.file === now.file) : -1;
    queue = makeQueue(library.length, Math.random, playing);
    failures = 0;
    if (!bar) bar = makeBar();
    bar.open(true);
    mediaKeys(true);
    start(library[queue.current()]);
  }

  function stopShuffle() {
    queue = null;
    if (audio) audio.pause();
    if (bar) bar.open(false);
    mediaKeys(false);
  }

  // ---- lock screen, car display, headset buttons ----

  function announce(track) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator) || typeof MediaMetadata === "undefined") return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title || document.title,
      artist: track.sub || "",
      album: "Hundred Days",
      artwork: [{ src: new URL(ROOT + "apple-touch-icon.png", location.href).href, sizes: "180x180", type: "image/png" }],
    });
  }

  function mediaKeys(on) {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    const set = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (e) { /* not supported */ } };
    set("nexttrack", on ? () => step(1) : null);
    set("previoustrack", on ? () => step(-1) : null);
  }

  // ---- shuffle bar ----

  function makeBar() {
    const el = document.createElement("div");
    el.className = "np";
    el.hidden = true;
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Shuffle all");
    el.innerHTML = `
      <div class="np-line"><i></i></div>
      <div class="np-in">
        <button class="np-btn np-prev" type="button" aria-label="Previous track"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h2v11h-2zM13.5 2.5v11L5.5 8z"/></svg></button>
        <button class="np-btn np-play" type="button" aria-label="Pause">
          <svg class="ic-play" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2.5v11l9-5.5z"/></svg>
          <svg class="ic-pause" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h3v11h-3zM9.5 2.5h3v11h-3z"/></svg>
        </button>
        <button class="np-btn np-next" type="button" aria-label="Next track"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M11.5 2.5h2v11h-2zM2.5 2.5v11l8-5.5z"/></svg></button>
        <div class="np-what"><div class="np-title"></div><div class="np-sub"></div></div>
        <div class="np-time"></div>
        <button class="np-btn np-close" type="button" aria-label="Stop shuffle"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.1 3 8 6.9 11.9 3 13 4.1 9.1 8l3.9 3.9-1.1 1.1L8 9.1 4.1 13 3 11.9 6.9 8 3 4.1z"/></svg></button>
      </div>`;
    document.body.appendChild(el);
    const q = (s) => el.querySelector(s);
    const line = q(".np-line i"), title = q(".np-title"), sub = q(".np-sub"), time = q(".np-time"), play = q(".np-play");
    q(".np-prev").addEventListener("click", () => step(-1));
    q(".np-next").addEventListener("click", () => step(1));
    q(".np-close").addEventListener("click", stopShuffle);
    play.addEventListener("click", toggle);
    return {
      open(on) { el.hidden = !on; document.body.classList.toggle("has-np", on); },
      show(track) {
        el.style.setProperty("--c", track.color || "var(--ink)");
        title.textContent = track.title;
        sub.textContent = track.sub;
        el.classList.remove("warn");
        line.style.width = "0";
        time.textContent = fmt(track.duration);
      },
      warn(text) { sub.textContent = text; el.classList.add("warn"); },   // in place of the note, on as many lines as it needs
      playing(on) { el.classList.toggle("playing", on); play.setAttribute("aria-label", on ? "Pause" : "Play"); },
      progress(f, text) { line.style.width = `${(f * 100).toFixed(2)}%`; time.textContent = text; },
    };
  }

  // ---- post rows ----

  function mountPlayers(container) {
    const made = [];
    container.querySelectorAll(".post[data-src]").forEach((el) => {
      if (el.dataset.mounted) return;
      el.dataset.mounted = "1";
      made.push(makePlayer(el));
    });
    players.push(...made);
    return made;
  }

  function makePlayer(el) {
    const file = el.dataset.src, src = ROOT + file;
    const btn = el.querySelector(".play");
    const time = el.querySelector(".time");
    const wave = el.querySelector(".wave");
    const [base, prog] = wave.querySelectorAll("canvas");
    const setProg = (f) => { prog.style.clipPath = `inset(0 ${(100 - f * 100).toFixed(2)}% 0 0)`; };
    let bars = null, duration = NaN, drawn = false;
    if (el.dataset.peaks) {
      bars = el.dataset.peaks.split(",").map(Number);
      duration = Number(el.dataset.duration) || NaN;
      if (isFinite(duration)) time.textContent = fmt(duration);
    }

    function color(alpha) {
      const c = getComputedStyle(el).getPropertyValue("--c").trim();
      return alpha ? "color-mix(in srgb, " + c + " 28%, transparent)" : c;
    }
    function draw() {
      const w = wave.clientWidth, h = wave.clientHeight, dpr = window.devicePixelRatio || 1;
      for (const c of [base, prog]) { c.width = w * dpr; c.height = h * dpr; }
      const n = Math.max(40, Math.floor(w / 4));
      const vals = bars ? resample(bars, n) : new Array(n).fill(0.18);
      [[base, color(true)], [prog, color(false)]].forEach(([c, fill]) => {
        const g = c.getContext("2d"); g.scale(dpr, dpr); g.fillStyle = fill;
        const bw = w / n;
        vals.forEach((v, i) => {
          const bh = Math.max(2, v * h);
          g.fillRect(i * bw + 0.5, (h - bh) / 2, bw - 1.5, bh);
        });
      });
      drawn = true;
    }
    function resample(arr, n) {
      const out = [], step = arr.length / n;
      for (let i = 0; i < n; i++) {
        let m = 0; const a = Math.floor(i * step), b = Math.max(a + 1, Math.floor((i + 1) * step));
        for (let j = a; j < b; j++) m = Math.max(m, arr[j]);
        out.push(m);
      }
      return out;
    }
    async function decode() {
      try {
        ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
        const buf = await (await fetch(src)).arrayBuffer();
        const ab = await ctx.decodeAudioData(buf);
        duration = ab.duration;
        const ch = ab.getChannelData(0), n = 400, step = Math.floor(ch.length / n);
        const peaks = [];
        let max = 0;
        for (let i = 0; i < n; i++) {
          let m = 0;
          for (let j = i * step; j < (i + 1) * step; j += 8) { const v = Math.abs(ch[j]); if (v > m) m = v; }
          peaks.push(m); if (m > max) max = m;
        }
        bars = peaks.map((v) => max ? Math.pow(v / max, 0.8) : 0);
        time.textContent = fmt(duration);
      } catch (e) { /* keep the flat placeholder */ }
      draw();
    }
    // what the playback code needs from this row while its file is the loaded one
    rows.set(file, {
      el,
      duration: () => duration,
      learn(d) { if (!isFinite(duration) && isFinite(d)) duration = d; },
      progress(f, text) { setProg(f); time.textContent = text; },
      rest() { el.classList.remove("playing"); setProg(0); time.textContent = fmt(duration); },
    });
    btn.addEventListener("click", () => press(file));
    wave.addEventListener("click", (e) => {
      const r = wave.getBoundingClientRect();
      press(file, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
    });
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io.disconnect(); draw();
        if (!bars) decode();   // no precomputed waveform: fall back to decoding on view
      }
    }, { rootMargin: "200px" });
    io.observe(el);
    return { redraw: () => drawn && draw() };
  }

  let rt;
  window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(() => players.forEach((p) => p.redraw()), 120); });

  // ---- share ----

  // On a phone: the system share sheet (Messages, etc). On a desktop: copy the link.
  function shareButton(btn, url, title) {
    if (!btn) return;
    const label = btn.textContent;
    const desktop = matchMedia("(hover: hover) and (pointer: fine)").matches;
    let t;
    btn.addEventListener("click", async () => {
      if (navigator.share && !desktop) {
        try { await navigator.share({ title, url }); } catch (e) { /* cancelled */ }
        return;
      }
      try {
        await navigator.clipboard.writeText(url);
        btn.textContent = "Link copied";
        clearTimeout(t);
        t = setTimeout(() => { btn.textContent = label; }, 1800);
      } catch (e) {
        location.href = url;   // no clipboard: open the page, the address bar has the link
      }
    });
  }

  window.HD = {
    ROOT, esc, fmt, load, colors, dayDate, dayUrl, topLine, renderPost, renderEmpty, renderDay, mountPlayers, shareButton,
    tracks, shuffled, makeQueue, shuffle, stopShuffle,
  };
})();
