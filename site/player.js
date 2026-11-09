// Shared page code: load posts.json, render a post row, run the waveform players,
// and the Share button. Used by index.html (site root) and by day/N/index.html,
// which sets data-root="../../" on <html> so every URL still points at the site root.
(function () {
  const ROOT = document.documentElement.getAttribute("data-root") || "";
  const SPARE = ["#ff4d1c", "#1f4fff", "#8f3dff", "#00a870"];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const fmt = (t) => isFinite(t) ? `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}` : "–:––";

  async function load() {
    const res = await fetch(ROOT + "posts.json", { cache: "no-store" });
    return res.json();
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

  // ---- players ----

  let ctx = null;     // one AudioContext for the fallback decoder
  let active = null;  // the <audio> that is playing, so only one plays at a time
  const players = [];

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
    const src = ROOT + el.dataset.src;
    const btn = el.querySelector(".play");
    const time = el.querySelector(".time");
    const wave = el.querySelector(".wave");
    const [base, prog] = wave.querySelectorAll("canvas");
    const setProg = (f) => { prog.style.clipPath = `inset(0 ${(100 - f * 100).toFixed(2)}% 0 0)`; };
    let audio = null, bars = null, duration = NaN, drawn = false;
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
    function ensureAudio() {
      if (audio) return audio;
      audio = new Audio(src);
      audio.preload = "metadata";
      audio.addEventListener("loadedmetadata", () => { if (!isFinite(duration)) { duration = audio.duration; time.textContent = fmt(duration); } });
      audio.addEventListener("timeupdate", () => {
        const d = audio.duration || duration;
        setProg(d ? audio.currentTime / d : 0);
        time.textContent = `${fmt(audio.currentTime)} / ${fmt(d)}`;
      });
      audio.addEventListener("ended", () => { el.classList.remove("playing"); setProg(0); time.textContent = fmt(duration); });
      audio.addEventListener("pause", () => el.classList.remove("playing"));
      audio.addEventListener("play", () => {
        if (active && active !== audio) active.pause();
        active = audio; el.classList.add("playing");
      });
      return audio;
    }
    btn.addEventListener("click", () => { const a = ensureAudio(); a.paused ? a.play() : a.pause(); });
    wave.addEventListener("click", (e) => {
      const a = ensureAudio();
      const d = a.duration || duration; if (!d) return;
      const r = wave.getBoundingClientRect();
      a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * d;
      if (a.paused) a.play();
    });
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io.disconnect(); draw();
        if (!bars) { ensureAudio(); decode(); }   // no precomputed waveform: fall back to decoding on view
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

  window.HD = { ROOT, esc, fmt, load, colors, dayDate, dayUrl, topLine, renderPost, renderEmpty, renderDay, mountPlayers, shareButton };
})();
