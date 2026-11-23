const test = require("node:test");
const assert = require("node:assert");

// player.js is a browser IIFE: give it the two globals it touches at load, then read window.HD.
globalThis.document = { documentElement: { getAttribute: (name) => (name === "data-root" ? "../../" : null) } };
globalThis.window = { addEventListener() {} };
require("./player.js");
const HD = globalThis.window.HD;

test("renderPost: every track gets a same-origin download link under its own file name", () => {
  const html = HD.renderPost({ name: "Bobby", makes: "a hook" }, { file: "audio/day-010-bobby.mp3", note: "hi" }, 10, "#ff4d1c");
  assert.match(html, /<a class="dl" href="\.\.\/\.\.\/audio\/day-010-bobby\.mp3" download /);
  assert.match(html, /aria-label="Download Bobby, day 10"/);
});

// a seeded random source, so a failed test repeats
function seeded(seed) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
}

test("shuffled: every track one time, in an order that is not the library order", () => {
  const order = HD.shuffled(54, seeded(1));
  assert.deepStrictEqual([...order].sort((a, b) => a - b), Array.from({ length: 54 }, (_, i) => i));
  assert.notDeepStrictEqual(order, Array.from({ length: 54 }, (_, i) => i));
});

test("shuffled: the index in notFirst never comes first", () => {
  for (let seed = 1; seed <= 200; seed++) {
    assert.notStrictEqual(HD.shuffled(3, seeded(seed), 1)[0], 1, `seed ${seed}`);
  }
  assert.deepStrictEqual(HD.shuffled(1, seeded(1), 0), [0]);   // one track: there is no other choice
});

test("makeQueue: plays the whole library before a track repeats, and has no end", () => {
  const n = 10, q = HD.makeQueue(n, seeded(7));
  const played = [q.current()];
  for (let i = 1; i < n * 5; i++) played.push(q.next());
  for (let round = 0; round < 5; round++) {
    assert.strictEqual(new Set(played.slice(round * n, (round + 1) * n)).size, n, `round ${round}`);
  }
  for (let i = 1; i < played.length; i++) assert.notStrictEqual(played[i], played[i - 1], `same track two times at ${i}`);
});

test("makeQueue: prev goes back through what played and stops at the first track", () => {
  const q = HD.makeQueue(5, seeded(3));
  const a = q.current(), b = q.next();
  q.next();
  assert.strictEqual(q.prev(), b);
  assert.strictEqual(q.prev(), a);
  assert.strictEqual(q.prev(), a);
  assert.strictEqual(q.next(), b);
});

test("makeQueue: a track picked by hand plays now and the order goes on after it", () => {
  const q = HD.makeQueue(5, seeded(3));
  const first = q.current();
  const pick = (first + 2) % 5;
  assert.strictEqual(q.jump(pick), pick);
  assert.strictEqual(q.current(), pick);
  assert.strictEqual(q.prev(), first);
  assert.strictEqual(q.next(), pick);
});

test("makeQueue: does not start with the track that plays now", () => {
  for (let seed = 1; seed <= 200; seed++) {
    assert.notStrictEqual(HD.makeQueue(4, seeded(seed), 2).current(), 2, `seed ${seed}`);
  }
});

test("tracks: one per post, with a title, the note on one line, and the person's color", () => {
  const data = {
    participants: [{ id: "bobby", name: "Bobby", makes: "a melodic hook" }, { id: "jason", name: "Jason", makes: "a bass line" }],
    posts: [
      { day: 34, who: "jason", file: "audio/day-034-jason.m4a", note: "", duration: 25.47 },
      { day: 35, who: "bobby", file: "audio/day-035-bobby.mp3", note: "knock.\n150 bpm, e.", duration: 52.8 },
      { day: 35, who: "nobody", file: "audio/day-035-nobody.mp3", note: "" },
    ],
  };
  assert.deepStrictEqual(HD.tracks(data), [
    { file: "audio/day-034-jason.m4a", day: 34, who: "jason", color: "var(--bass)", duration: 25.47, title: "Day 34 · Jason", sub: "a bass line" },
    { file: "audio/day-035-bobby.mp3", day: 35, who: "bobby", color: "var(--hook)", duration: 52.8, title: "Day 35 · Bobby", sub: "knock. 150 bpm, e." },
  ]);
});

test("renderPost: the file path is escaped in the link", () => {
  const html = HD.renderPost({ name: "A", makes: "x" }, { file: 'audio/a"b.mp3' }, 1, "#000");
  assert.ok(html.includes('href="../../audio/a&quot;b.mp3"'));
});
