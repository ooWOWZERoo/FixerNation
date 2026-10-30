/**
 * How-to video pipeline (ported from the Fixer Nation Org project, adapted for this site).
 *
 * A storyboard is a list of steps. Each step has narration and an optional Playwright action.
 * For every step we synthesize speech with the macOS voice Ava (Premium), perform the action on
 * screen while it plays, and hold until the narration finishes. Then ffmpeg lays the audio over the
 * recording, compresses it to 720p, and a WebVTT caption file is written from the same timings.
 *
 * It records against the local throwaway test site (tests/howto/stack.sh), never production, unless
 * HOWTO_ALLOW_PROD=1 is set on purpose. Output goes to tests/howto-out/<slug>/ (git-ignored).
 * Nothing is uploaded here.
 */
import { chromium, type Page, type BrowserContext } from "@playwright/test";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import path from "path";

const ffmpeg = createRequire(__filename)("ffmpeg-static") as string;

export interface Step {
  say: string;
  run?: (page: Page) => Promise<void>;
}

export interface Storyboard {
  slug: string;
  title: string;
  /** Who signs in off-camera before recording. Omit for a signed-out start. */
  as?: "school-admin" | "district-admin";
  /** Path to open first. */
  startPath: string;
  /** Opens the first screen yourself instead of going to startPath (e.g. to start on an email). */
  open?: (page: Page) => Promise<void>;
  /** Runs off-camera before recording (create the situation the video needs). */
  setup?: () => Promise<void>;
  steps: Step[];
  /** Always runs after recording, even on failure. */
  cleanup?: (page: Page) => Promise<void>;
}

const PAUSE_AFTER_STEP = 0.7; // seconds of breathing room after each narration
const SIZE = { width: 1280, height: 720 };
const RATE = process.env.HOWTO_RATE ?? "165"; // words per minute
const VOICE = process.env.HOWTO_VOICE ?? "Ava (Premium)";

export const env = {
  baseUrl: process.env.HOWTO_BASE_URL ?? "http://localhost:3002",
  password: process.env.HOWTO_PASSWORD ?? "",
  schoolAdmin: process.env.HOWTO_SCHOOL_ADMIN ?? "",
  districtAdmin: process.env.HOWTO_DISTRICT_ADMIN ?? "",
  mailApi: process.env.HOWTO_MAIL_API ?? "http://localhost:8026",
};

export function guard() {
  if (!env.password) {
    console.error("No demo password. Start the test site first: tests/howto/stack.sh up, then run with --env-file=tests/howto/.env.howto.local");
    process.exit(1);
  }
  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(env.baseUrl) && process.env.HOWTO_ALLOW_PROD !== "1") {
    console.error(`Refusing to record against ${env.baseUrl}. Videos are recorded on the local test site. Set HOWTO_ALLOW_PROD=1 only if you mean it.`);
    process.exit(1);
  }
}

function sh(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${path.basename(cmd)} failed:\n${r.stderr?.slice(-1500)}`);
  return r;
}

function durationOf(file: string): number {
  const r = spawnSync(ffmpeg, ["-i", file], { encoding: "utf8" });
  const m = /Duration: (\d+):(\d+):(\d+\.\d+)/.exec(r.stderr);
  if (!m) throw new Error(`Cannot read duration of ${file}`);
  return +m[1] * 3600 + +m[2] * 60 + +m[3];
}

const vttTime = (s: number) => {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

// A visible cursor and click ripple so viewers can follow the mouse.
const CURSOR_SCRIPT = `
(() => {
  if (window.__fnCursor) return; window.__fnCursor = true;
  const dot = document.createElement('div');
  dot.style.cssText = 'position:fixed;z-index:2147483647;width:24px;height:24px;margin:-12px 0 0 -12px;border-radius:50%;background:rgba(242,107,77,.5);border:2px solid #D9502F;pointer-events:none;transition:transform .12s;left:-50px;top:-50px';
  const attach = () => document.documentElement.appendChild(dot);
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', attach) : attach();
  addEventListener('mousemove', e => { dot.style.left = e.clientX + 'px'; dot.style.top = e.clientY + 'px'; }, true);
  addEventListener('mousedown', () => { dot.style.transform = 'scale(.6)'; }, true);
  addEventListener('mouseup', () => { dot.style.transform = 'scale(1)'; }, true);
})();`;

/** Move the mouse to an element in a visible glide, then click it. */
export async function glideClick(page: Page, selector: string) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`Not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
  await page.waitForTimeout(150);
  await page.mouse.down();
  await page.mouse.up();
}

/** Glide to an element without clicking (to point at something while it is described). */
export async function glideTo(page: Page, selector: string) {
  const loc = page.locator(selector).first();
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`Not visible: ${selector}`);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
}

/** Click into a field and type at a readable speed. */
export async function fillSlowly(page: Page, selector: string, text: string, delay = 55) {
  await glideClick(page, selector);
  await page.keyboard.type(text, { delay });
}

// ---- The local mail catcher (every email the test site sends lands there) ----------------------
export async function latestMail(to: string, subjectIncludes = "") {
  for (let i = 0; i < 20; i++) {
    const r = await fetch(`${env.mailApi}/api/v1/search?query=${encodeURIComponent("to:" + to)}`);
    const list = (await r.json()) as { messages?: { ID: string; Subject: string }[] };
    const hit = (list.messages ?? []).find((m) => m.Subject.includes(subjectIncludes));
    if (hit) return (await (await fetch(`${env.mailApi}/api/v1/message/${hit.ID}`)).json()) as {
      Subject: string; HTML: string; Text: string; From: { Name: string; Address: string }; To: { Address: string }[];
    };
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`No email to ${to} containing "${subjectIncludes}"`);
}

/** Show an email on screen as a plain, readable inbox view. Its links go to the real test site. */
export async function showEmail(page: Page, mail: Awaited<ReturnType<typeof latestMail>>) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<!doctype html><meta charset="utf-8"><title>Inbox</title>
<body style="margin:0;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;background:#f3f4f6">
<div style="max-width:760px;margin:28px auto;background:#fff;border-radius:10px;box-shadow:0 1px 6px rgba(0,0,0,.15);overflow:hidden">
<div style="padding:16px 22px;border-bottom:1px solid #e5e7eb">
<div style="font-size:20px;font-weight:600;margin-bottom:8px">${esc(mail.Subject)}</div>
<div style="font-size:13px;color:#555"><b>${esc(mail.From.Name || mail.From.Address)}</b> &lt;${esc(mail.From.Address)}&gt;<br>to ${esc(mail.To.map((t) => t.Address).join(", "))}</div></div>
<div style="padding:8px 22px 28px">${mail.HTML}</div></div></body>`;
  await page.route("**/__howto-inbox", (route) => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/__howto-inbox");
}

/** Run SQL against the throwaway test database (local only; used by setup steps). */
export function sql(query: string) {
  const r = spawnSync("docker", ["exec", "fne-howto-db", "mariadb", "-uroot", "-phowto", "-N", "fne_howto", "-e", query], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`SQL failed: ${r.stderr}`);
  return r.stdout.trim();
}

/** Act as FNE staff (sign in to the admin API) and POST JSON, the way the staff pages do. */
export async function staffPost(apiPath: string, body: unknown) {
  const login = await fetch(`${env.baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: process.env.HOWTO_STAFF_USER ?? "howto-admin", password: env.password }),
  });
  if (!login.ok) throw new Error(`Staff sign-in failed (${login.status})`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  const r = await fetch(`${env.baseUrl}${apiPath}`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`POST ${apiPath} failed (${r.status}): ${await r.text()}`);
  return r.json();
}

/** Sign in off-camera by the same call the sign-in page makes, and save the session. */
async function signIn(baseUrl: string, email: string, storagePath: string) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ baseURL: baseUrl });
  const r = await ctx.request.post("/api/site-auth/login", { data: { email, password: env.password } });
  if (!r.ok()) throw new Error(`Sign-in as ${email} failed (${r.status()}). Is the test site seeded?`);
  await ctx.storageState({ path: storagePath });
  await browser.close();
}

export async function produce(board: Storyboard, outRoot = path.join(__dirname, "..", "howto-out")) {
  guard();
  const out = path.join(outRoot, board.slug);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, "audio"), { recursive: true });

  // 1. Narration audio per step.
  const clips = board.steps.map((s, i) => {
    const file = path.join(out, "audio", `step-${String(i + 1).padStart(2, "0")}.aiff`);
    sh("say", ["-v", VOICE, "-r", RATE, "-o", file, s.say]);
    return { file, dur: durationOf(file) };
  });

  // 2. Set up the situation and sign in off-camera, then record.
  await board.setup?.();
  const storage = path.join(out, "storage-state.json");
  if (board.as) await signIn(env.baseUrl, board.as === "school-admin" ? env.schoolAdmin : env.districtAdmin, storage);

  const browser = await chromium.launch();
  const ctx: BrowserContext = await browser.newContext({
    baseURL: env.baseUrl,
    viewport: SIZE,
    recordVideo: { dir: path.join(out, "raw"), size: SIZE },
    ...(board.as ? { storageState: storage } : {}),
  });
  await ctx.addInitScript(CURSOR_SCRIPT);
  const page = await ctx.newPage();
  const t0 = Date.now();
  const now = () => (Date.now() - t0) / 1000;
  const starts: number[] = [];
  let failure: unknown;

  try {
    if (board.open) await board.open(page); else await page.goto(board.startPath);
    await page.waitForTimeout(800);
    for (let i = 0; i < board.steps.length; i++) {
      starts.push(now());
      const end = now() + clips[i].dur + PAUSE_AFTER_STEP;
      await board.steps[i].run?.(page);
      const left = (end - now()) * 1000;
      if (left > 0) await page.waitForTimeout(left);
    }
    await page.waitForTimeout(600);
  } catch (e) {
    failure = e;
    await page.screenshot({ path: path.join(out, "failure.png") }).catch(() => {});
  } finally {
    try { await board.cleanup?.(page); } catch (e) { console.error("cleanup failed:", e); }
    const video = page.video();
    await ctx.close();
    await browser.close();
    fs.rmSync(storage, { force: true }); // holds a signed-in session; never keep it around
    if (failure) throw failure;

    // 3. Mix narration at each step's start time, mux, compress to 720p.
    const rawVideo = await video!.path();
    const inputs = clips.flatMap((c) => ["-i", c.file]);
    const delays = starts.map((s, i) => `[${i + 1}:a]adelay=${Math.round(s * 1000)}|${Math.round(s * 1000)}[a${i}]`);
    const mix = `${delays.join(";")};${starts.map((_, i) => `[a${i}]`).join("")}amix=inputs=${starts.length}:normalize=0[aout]`;
    const mp4 = path.join(out, `${board.slug}.mp4`);
    sh(ffmpeg, [
      "-y", "-i", rawVideo, ...inputs, "-filter_complex", mix,
      "-map", "0:v", "-map", "[aout]",
      "-c:v", "libx264", "-crf", "28", "-preset", "medium", "-pix_fmt", "yuv420p",
      "-vf", "scale=1280:-2", "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", mp4,
    ]);

    // 4. Captions and poster frame from the same timings.
    const total = durationOf(mp4);
    const cues = board.steps.map((s, i) => {
      const a = starts[i];
      const b = Math.min(a + clips[i].dur + 0.2, i + 1 < starts.length ? starts[i + 1] : total);
      return `${i + 1}\n${vttTime(a)} --> ${vttTime(b)}\n${s.say}\n`;
    });
    fs.writeFileSync(path.join(out, `${board.slug}.vtt`), `WEBVTT\n\n${cues.join("\n")}`);
    sh(ffmpeg, ["-y", "-ss", "2", "-i", mp4, "-frames:v", "1", path.join(out, `${board.slug}-poster.jpg`)]);

    const mb = (fs.statSync(mp4).size / 1048576).toFixed(1);
    console.log(`\nDone: ${mp4}\n  ${total.toFixed(0)}s, ${mb} MB\n  captions: ${board.slug}.vtt\n  poster:   ${board.slug}-poster.jpg`);
    return mp4;
  }
}
