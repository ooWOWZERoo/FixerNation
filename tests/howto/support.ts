// Off-camera helpers for the Get help videos (G1 to G3): send requests as a visitor or as the demo teacher, and answer them as FNE
// staff, through the same routes the pages call. Local test site only.
import { env, sql, staffRequest } from "./pipeline";
import { asUser } from "./api";

/** A request from someone who is not signed in. Returns its reference. */
export async function visitorRequest(body: { name: string; email: string; category: string; subject: string; message: string; sessionId?: string }) {
  const r = await fetch(`${env.baseUrl}/api/support`, { method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Visitor request failed (${r.status}): ${await r.text()}`);
  return ((await r.json()) as { ref: string }).ref;
}

/** A request from the demo teacher (signed in). Returns its reference. */
export async function teacherRequest(body: { category: string; subject: string; message: string; sessionId?: string }) {
  const teacher = await asUser(env.teacher);
  return (await teacher("POST", "/api/support", body)).ref as string;
}

/** Staff answer a request by its reference ('public' is shown to the person; 'internal' is a staff note). */
export async function staffReply(ref: string, body: string, visibility: "public" | "internal" = "public") {
  const id = Number(sql(`SELECT id FROM support_requests WHERE ref = '${ref}'`));
  if (!id) throw new Error(`No support request ${ref}`);
  await staffRequest("POST", `/api/admin/support/${id}/messages`, { body, visibility });
}

/** The demo teacher's browser reports an error (as a signed-in person, so the request panel can match it). */
export async function teacherBrowserError(report: Record<string, unknown>) {
  const teacher = await asUser(env.teacher);
  await teacher("POST", "/api/client-errors", report);
}
