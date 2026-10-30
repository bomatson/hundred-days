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

test("renderPost: the file path is escaped in the link", () => {
  const html = HD.renderPost({ name: "A", makes: "x" }, { file: 'audio/a"b.mp3' }, 1, "#000");
  assert.ok(html.includes('href="../../audio/a&quot;b.mp3"'));
});
