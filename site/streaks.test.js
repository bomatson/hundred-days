const test = require("node:test");
const assert = require("node:assert");
const S = require("./streaks.js");

test("dayNumber: start date is day 1", () => {
  assert.equal(S.dayNumber("2026-10-20", S.parseDate("2026-10-20")), 1);
  assert.equal(S.dayNumber("2026-10-20", S.parseDate("2026-10-21")), 2);
  assert.equal(S.dayNumber("2026-10-20", S.parseDate("2026-10-19")), 0);
  assert.equal(S.dayNumber("2026-10-20", S.parseDate("2027-01-27")), 100);
});

test("stats: current streak counts back from today if posted today", () => {
  const posts = [1, 2, 3].map((day) => ({ day, who: "bobby" }));
  const s = S.stats(posts, "bobby", 3, 100);
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.equal(s.total, 3);
  assert.equal(s.postedToday, true);
});

test("stats: today not yet posted does not break the streak", () => {
  const posts = [1, 2, 3].map((day) => ({ day, who: "bobby" }));
  const s = S.stats(posts, "bobby", 4, 100);
  assert.equal(s.current, 3);
  assert.equal(s.cells[3].state, "today");
  assert.equal(s.postedToday, false);
});

test("stats: a missed day resets current but keeps longest", () => {
  const posts = [1, 2, 3, 5, 6].map((day) => ({ day, who: "jason" }));
  const s = S.stats(posts, "jason", 6, 100);
  assert.equal(s.current, 2);
  assert.equal(s.longest, 3);
  assert.equal(s.cells[3].state, "missed");
  assert.equal(s.cells[6].state, "future");
});

test("stats: other participants' posts are ignored", () => {
  const posts = [{ day: 1, who: "bobby" }, { day: 1, who: "jason" }, { day: 2, who: "jason" }];
  assert.equal(S.stats(posts, "bobby", 2, 100).current, 1);
  assert.equal(S.stats(posts, "jason", 2, 100).current, 2);
});

test("stats: before start and after end are clamped", () => {
  const s0 = S.stats([], "bobby", -5, 100);
  assert.equal(s0.current, 0);
  assert.equal(s0.cells[0].state, "future");
  const all = Array.from({ length: 100 }, (_, i) => ({ day: i + 1, who: "bobby" }));
  const s1 = S.stats(all, "bobby", 140, 100);
  assert.equal(s1.current, 100);
  assert.equal(s1.longest, 100);
});
