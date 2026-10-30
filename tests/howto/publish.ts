/**
 * Publishes recorded videos:   npm run howto:publish -- B1 B2
 *
 *  1. Copies each video's captions (.vtt) and poster image into help-assets/ at the site root
 *     (small files, served by the site itself so captions load same-origin).
 *  2. Uploads the mp4 to Cloudinary as fne/help/<ID> (overwrites an earlier upload of the same video).
 *  3. Fills in that video's url, captions and poster in help-videos.js.
 *
 * Cloudinary credentials come from tests/howto/.env.cloudinary.local (git-ignored), never from the repo:
 *   CLOUDINARY_CLOUD_NAME=...   CLOUDINARY_API_KEY=...   CLOUDINARY_API_SECRET=...
 * Without them, steps 1 and 3 still run if you pass --url <https link> after the id.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import dotenv from "dotenv";

const root = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(__dirname, ".env.cloudinary.local") });

const ids = process.argv.slice(2).filter((a) => /^[A-Z]\d+$/.test(a));
if (!ids.length) { console.error("Usage: npm run howto:publish -- B1 [B2 ...]"); process.exit(1); }
const { CLOUDINARY_CLOUD_NAME: cloud, CLOUDINARY_API_KEY: key, CLOUDINARY_API_SECRET: secret } = process.env;
if (!cloud || !key || !secret) { console.error("Missing Cloudinary credentials in tests/howto/.env.cloudinary.local (see the header of this file)."); process.exit(1); }

async function upload(id: string, file: string): Promise<string> {
  const params: Record<string, string> = { invalidate: "true", overwrite: "true", public_id: `fne/help/${id}`, timestamp: String(Math.floor(Date.now() / 1000)) };
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = crypto.createHash("sha1").update(toSign + secret).digest("hex");
  const form = new FormData();
  for (const [k, v] of Object.entries({ ...params, api_key: key!, signature })) form.append(k, v);
  form.append("file", new Blob([fs.readFileSync(file)], { type: "video/mp4" }), `${id}.mp4`);
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/video/upload`, { method: "POST", body: form });
  const j = (await r.json()) as { secure_url?: string; error?: { message: string } };
  if (!r.ok || !j.secure_url) throw new Error(`Cloudinary upload of ${id} failed: ${j.error?.message ?? r.status}`);
  return j.secure_url;
}

(async () => {
  const registryFile = path.join(root, "help-videos.js");
  let registry = fs.readFileSync(registryFile, "utf8");
  fs.mkdirSync(path.join(root, "help-assets"), { recursive: true });
  for (const id of ids) {
    const dir = path.join(__dirname, "..", "howto-out", id);
    const mp4 = path.join(dir, `${id}.mp4`);
    if (!fs.existsSync(mp4)) { console.error(`${id}: not recorded yet (no ${mp4})`); continue; }
    fs.copyFileSync(path.join(dir, `${id}.vtt`), path.join(root, "help-assets", `${id}.vtt`));
    fs.copyFileSync(path.join(dir, `${id}-poster.jpg`), path.join(root, "help-assets", `${id}.jpg`));
    const url = await upload(id, mp4);
    // Update this video's entry: its block runs from "id: 'ID'" to its closing "}".
    const start = registry.indexOf(`{ id: '${id}'`);
    const end = registry.indexOf("}", registry.indexOf("url:", start));
    if (start < 0 || end < 0) throw new Error(`${id} is not in help-videos.js`);
    let block = registry.slice(start, end + 1);
    block = block.replace(/,?\s*(url|captions|poster): '[^']*'/g, "").replace(/\s*\}$/, "");
    block = `${block}, url: '${url}', captions: '/help-assets/${id}.vtt', poster: '/help-assets/${id}.jpg' }`;
    registry = registry.slice(0, start) + block + registry.slice(end + 1);
    console.log(`${id}: uploaded -> ${url}`);
  }
  fs.writeFileSync(registryFile, registry);
  console.log("help-videos.js updated. Bump help-videos.js?v=N on the pages, run the video check, then commit.");
})().catch((e) => { console.error(e); process.exit(1); });
