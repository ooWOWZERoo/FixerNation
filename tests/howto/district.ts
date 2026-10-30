// Off-camera helpers for the Portrait of a Graduate videos (C5, C6, C7): act as the demo district administrator or as FNE staff
// through the same routes the pages use, to put a made-up framework in the throwaway test site's database.
// Everything here is fictional (Riverbend School District, example.com links). Never put a real district's framework in.
import { env } from "./pipeline";

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function signIn(loginPath: string, body: unknown): Promise<string> {
  const r = await fetch(`${env.baseUrl}${loginPath}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Sign-in at ${loginPath} failed (${r.status})`);
  return (r.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function call(cookie: string, method: Method, apiPath: string, body?: unknown) {
  const r = await fetch(`${env.baseUrl}${apiPath}`, {
    method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(`${method} ${apiPath} failed (${r.status}): ${await r.text()}`);
  return r.json() as Promise<any>;
}

export async function districtAdmin() {
  const cookie = await signIn("/api/site-auth/login", { email: env.districtAdmin, password: env.password });
  return (method: Method, p: string, body?: unknown) => call(cookie, method, `/api/district-admin/standards${p}`, body);
}

export async function staff() {
  const cookie = await signIn("/api/auth/login", { username: process.env.HOWTO_STAFF_USER ?? "howto-admin", password: env.password });
  return (method: Method, p: string, body?: unknown) => call(cookie, method, `/api/admin/standards${p}`, body);
}

const today = () => new Date().toISOString().slice(0, 10);

export const PORTRAIT_ITEMS = [
  { code: "1", title: "Curious Learner", gradeBand: "K-12", caselCompetency: "self_awareness",
    summary: "Students notice what they are good at, ask questions, and keep going when something is hard." },
  { code: "2", title: "Kind Collaborator", gradeBand: "K-12", caselCompetency: "relationship_skills",
    summary: "Students listen, share the work fairly, and help classmates feel they belong." },
  { code: "3", title: "Thoughtful Decision-Maker", gradeBand: "K-12", caselCompetency: "responsible_decision_making",
    summary: "Students stop to think about how a choice affects themselves and others before they act." },
];

/** Creates a draft framework with items for Riverbend School District and returns its id and item ids. */
export async function createFramework(opts: { name: string; type?: "portrait_of_graduate" | "sel_standards"; items?: typeof PORTRAIT_ITEMS }) {
  const d = await districtAdmin();
  const created = await d("POST", "/frameworks", {
    districtId: 1, name: opts.name, type: opts.type ?? "portrait_of_graduate", stateCode: "OH", issuingBody: "Riverbend School District",
    officialUrl: "https://riverbend.example.com/portrait-of-a-graduate", sourceAccessedOn: today(), adoptedYear: 2023, gradeSpan: "K-12",
  });
  await d("PUT", `/frameworks/${created.id}/items`, { items: opts.items ?? PORTRAIT_ITEMS });
  const list = await d("GET", "/?districtId=1");
  const fw = list.frameworks.find((f: any) => f.id === created.id);
  return { id: created.id as number, itemIds: fw.items.map((i: any) => i.id) as number[] };
}

export async function submit(frameworkId: number) {
  const d = await districtAdmin();
  await d("POST", `/frameworks/${frameworkId}/submit`, { attest: true });
}

/** Acts as FNE staff: checks the framework, writes the program-level connection explanations, and publishes everything. */
export async function publish(frameworkId: number, itemIds: number[]) {
  const s = await staff();
  await s("POST", `/frameworks/${frameworkId}/verify`);
  for (const itemId of itemIds) {
    const a = await s("PUT", "/alignments", {
      itemId, targetType: "program", targetId: 0, strength: "direct",
      rationale: "Fixer Nation lessons give students short, guided practice with this skill in a classroom setting.",
    });
    await s("POST", `/alignments/${a.id}/verify`);
  }
}
