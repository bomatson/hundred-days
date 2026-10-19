import test from "node:test";
import assert from "node:assert";
import worker, { identify, targetName, toBase64 } from "./src/index.js";

const env = {
  REPO: "bomatson/hundred-days",
  ALLOWED_ORIGINS: "https://bomatson.github.io",
  MAX_MB: "25",
  GITHUB_TOKEN: "t",
  PASSCODES: JSON.stringify({ jason: "Swing-7", drew: "tape-3" }),
};

// fake GitHub contents API
let store;
const calls = [];
globalThis.fetch = async (url, init = {}) => {
  const path = url.replace("https://api.github.com/repos/bomatson/hundred-days/contents/", "");
  calls.push([init.method, path]);
  if (init.method === "GET") {
    if (path === "audio") return new Response(JSON.stringify(Object.entries(store).map(([name, sha]) => ({ name, sha }))), { status: 200 });
    return new Response("{}", { status: 404 });
  }
  const body = JSON.parse(init.body);
  const name = path.replace("audio/", "");
  if (init.method === "PUT") {
    if (store[name] && body.sha !== store[name]) return new Response("sha mismatch", { status: 409 });
    store[name] = "sha-" + name; return new Response("{}", { status: 201 });
  }
  if (init.method === "DELETE") { delete store[name]; return new Response("{}", { status: 200 }); }
  return new Response("nope", { status: 500 });
};

function req(path, fields, origin = "https://bomatson.github.io") {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  return new Request("https://w.example" + path, { method: "POST", body: fd, headers: { Origin: origin } });
}
const memo = (name = "New Recording 3.m4a") => new File([new Uint8Array([1, 2, 3, 4])], name, { type: "audio/mp4" });

test("identify: passcode maps to a person, case-insensitive", () => {
  assert.equal(identify("swing-7", env), "jason");
  assert.equal(identify(" TAPE-3 ", env), "drew");
  assert.equal(identify("nope", env), null);
  assert.equal(identify("", env), null);
});

test("targetName: day and extension rules", () => {
  assert.equal(targetName("3", "drew", "New Recording.m4a").name, "day-003-drew.m4a");
  assert.throws(() => targetName("0", "drew", "a.m4a"), /1 to 100/);
  assert.throws(() => targetName("101", "drew", "a.m4a"), /1 to 100/);
  assert.throws(() => targetName("5", "drew", "a.txt"), /not accepted/);
});

test("toBase64 round-trips", () => {
  assert.equal(toBase64(new TextEncoder().encode("hello")), "aGVsbG8=");
});

test("whoami returns the person for a passcode", async () => {
  const r = await worker.fetch(req("/whoami", { passcode: "tape-3" }), env);
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { who: "drew", name: "Drew" });
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://bomatson.github.io");
});

test("wrong passcode is rejected before anything else", async () => {
  store = {}; calls.length = 0;
  const r = await worker.fetch(req("/upload", { passcode: "x", day: "1", file: memo() }), env);
  assert.equal(r.status, 401);
  assert.equal(calls.length, 0);
});

test("upload commits the audio and note under the sender's name", async () => {
  store = {}; calls.length = 0;
  const r = await worker.fetch(req("/upload", { passcode: "swing-7", day: "4", note: "E, slap", file: memo() }), env);
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.who, "jason");
  assert.equal(body.file, "audio/day-004-jason.m4a");
  assert.ok(store["day-004-jason.m4a"]);
  assert.ok(store["day-004-jason.md"]);
  assert.ok(!Object.keys(store).some((k) => k.includes("drew")));
});

test("second upload for the same day is refused unless replace is set", async () => {
  store = { "day-004-jason.mp3": "sha-old" }; calls.length = 0;
  let r = await worker.fetch(req("/upload", { passcode: "swing-7", day: "4", file: memo() }), env);
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).exists, ["day-004-jason.mp3"]);
  r = await worker.fetch(req("/upload", { passcode: "swing-7", day: "4", file: memo(), replace: "1" }), env);
  assert.equal(r.status, 200);
  assert.ok(!store["day-004-jason.mp3"], "old extension removed");
  assert.ok(store["day-004-jason.m4a"]);
});

test("oversize and bad types are refused", async () => {
  store = {};
  const big = new File([new Uint8Array(26 * 1024 * 1024)], "x.m4a");
  let r = await worker.fetch(req("/upload", { passcode: "tape-3", day: "2", file: big }), env);
  assert.equal(r.status, 413);
  r = await worker.fetch(req("/upload", { passcode: "tape-3", day: "2", file: memo("notes.txt") }), env);
  assert.equal(r.status, 400);
});

test("preflight from an unknown origin does not get that origin back", async () => {
  const r = await worker.fetch(new Request("https://w.example/upload", { method: "OPTIONS", headers: { Origin: "https://evil.example" } }), env);
  assert.equal(r.status, 204);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), "https://bomatson.github.io");
});
