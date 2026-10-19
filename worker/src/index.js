// Cloudflare Worker: receives an audio upload and commits it to the repo.
//
// POST /whoami   form: passcode                      -> { who, name }
// POST /upload   form: passcode, day, file, note?, replace? -> { ok, who, day, file }
//
// Secrets (wrangler secret put):
//   GITHUB_TOKEN  fine-grained PAT, Contents: read and write, this repo only
//   PASSCODES     JSON, e.g. {"jason":"swing-7","drew":"tape-3","bobby":"..."}
// Vars (wrangler.toml): REPO, ALLOWED_ORIGINS, MAX_MB

const EXT_MIME = { m4a: 1, mp3: 1, wav: 1, caf: 1, ogg: 1, aif: 1, aiff: 1 };
const NAMES = { bobby: "Bobby", jason: "Jason", drew: "Drew" };

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const url = new URL(request.url);
    try {
      if (request.method === "GET") return json({ ok: true, service: "hundred-days upload" }, 200, cors);
      if (request.method !== "POST") return json({ error: "method not allowed" }, 405, cors);
      const form = await request.formData();
      const who = identify(form.get("passcode"), env);
      if (!who) return json({ error: "wrong passcode" }, 401, cors);
      if (url.pathname === "/whoami") return json({ who, name: NAMES[who] || who }, 200, cors);
      if (url.pathname === "/upload") return json(await upload(form, who, env), 200, cors);
      return json({ error: "not found" }, 404, cors);
    } catch (e) {
      const status = e.status || 500;
      return json({ error: e.message || String(e), ...(e.extra || {}) }, status, cors);
    }
  },
};

function corsHeaders(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin) || allowed.includes("*") || /^http:\/\/localhost(:\d+)?$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...headers } });
}

function fail(status, message, extra) {
  const e = new Error(message); e.status = status; e.extra = extra; return e;
}

export function identify(passcode, env) {
  if (!passcode || typeof passcode !== "string") return null;
  let codes;
  try { codes = JSON.parse(env.PASSCODES || "{}"); } catch { return null; }
  const given = passcode.trim().toLowerCase();
  for (const [who, code] of Object.entries(codes)) {
    if (String(code).trim().toLowerCase() === given) return who;
  }
  return null;
}

export function targetName(day, who, filename) {
  const d = parseInt(day, 10);
  if (!Number.isInteger(d) || d < 1 || d > 100) throw fail(400, "day must be 1 to 100");
  const ext = String(filename || "").toLowerCase().split(".").pop();
  if (!EXT_MIME[ext]) throw fail(400, `file type .${ext} not accepted (m4a, mp3, wav, caf, ogg, aif)`);
  return { day: d, ext, name: `day-${String(d).padStart(3, "0")}-${who}.${ext}` };
}

async function upload(form, who, env) {
  const file = form.get("file");
  if (!file || typeof file === "string" || !file.size) throw fail(400, "no file");
  const maxMb = Number(env.MAX_MB || 25);
  if (file.size > maxMb * 1024 * 1024) throw fail(413, `file is over ${maxMb} MB`);
  const { day, name } = targetName(form.get("day"), who, file.name || "voice.m4a");
  const replace = ["1", "true", "yes"].includes(String(form.get("replace") || "").toLowerCase());
  const gh = github(env);

  // existing posts for this day + person, any extension
  const listing = await gh.list("audio");
  const prefix = `day-${String(day).padStart(3, "0")}-${who}.`;
  const existing = listing.filter((f) => f.name.startsWith(prefix) && !f.name.endsWith(".md"));
  if (existing.length && !replace) throw fail(409, `day ${day} already has a post from ${NAMES[who] || who}`, { exists: existing.map((f) => f.name) });

  const content = toBase64(new Uint8Array(await file.arrayBuffer()));
  const msg = `Day ${String(day).padStart(3, "0")}: ${who} (upload)`;
  let sha;
  for (const f of existing) {
    if (f.name === name) sha = f.sha;
    else await gh.remove(`audio/${f.name}`, f.sha, msg);
  }
  await gh.put(`audio/${name}`, content, msg, sha);

  const note = String(form.get("note") || "").trim();
  const notePath = `audio/${prefix}md`;
  const noteFile = listing.find((f) => f.name === `${prefix}md`);
  if (note) await gh.put(notePath, toBase64(new TextEncoder().encode(note + "\n")), msg, noteFile && noteFile.sha);
  else if (noteFile && replace) await gh.remove(notePath, noteFile.sha, msg);

  return { ok: true, who, name: NAMES[who] || who, day, file: `audio/${name}`, bytes: file.size };
}

function github(env) {
  const base = `${env.GITHUB_API || "https://api.github.com"}/repos/${env.REPO}/contents/`;
  const headers = {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "hundred-days-upload",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  async function call(method, path, body) {
    const r = await fetch(base + path, { method, headers: body ? { ...headers, "Content-Type": "application/json" } : headers, body: body && JSON.stringify(body) });
    if (method === "GET" && r.status === 404) return null;
    if (!r.ok) {
      const t = await r.text();
      throw fail(502, `github ${method} ${path} failed: ${r.status} ${t.slice(0, 200)}`);
    }
    return r.json();
  }
  return {
    list: async (dir) => (await call("GET", dir)) || [],
    put: (path, content, message, sha) => call("PUT", path, { message, content, ...(sha ? { sha } : {}) }),
    remove: (path, sha, message) => call("DELETE", path, { message, sha }),
  };
}

export function toBase64(bytes) {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) s += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  return btoa(s);
}
