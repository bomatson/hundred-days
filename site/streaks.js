// Pure streak math. Runs in the browser (window.Streaks) and in node (module.exports).
(function (root) {
  function parseDate(s) {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  }

  function localToday(now) {
    const d = now || new Date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  }

  // 1-based day number for a given date (UTC-midnight ms). Day 1 == start_date.
  function dayNumber(startDate, todayMs) {
    return Math.floor((todayMs - parseDate(startDate)) / 86400000) + 1;
  }

  // posts: [{day, who}], who: participant id, todayDay: integer, days: total days
  function stats(posts, who, todayDay, days) {
    const posted = new Set(posts.filter((p) => p.who === who).map((p) => p.day));
    const cur = Math.min(Math.max(todayDay, 0), days);
    const cells = [];
    let longest = 0, run = 0;
    for (let d = 1; d <= days; d++) {
      let state;
      if (posted.has(d)) state = "posted";
      else if (d < cur) state = "missed";
      else if (d === cur) state = "today";
      else state = "future";
      cells.push({ day: d, state });
      if (posted.has(d)) { run++; if (run > longest) longest = run; } else run = 0;
    }
    let current = 0;
    let d = posted.has(cur) ? cur : cur - 1;
    while (d >= 1 && posted.has(d)) { current++; d--; }
    return { total: posted.size, current, longest, cells, postedToday: posted.has(cur) };
  }

  const api = { parseDate, localToday, dayNumber, stats };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Streaks = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
