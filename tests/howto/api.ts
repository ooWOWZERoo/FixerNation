// Off-camera helper for the wave 2 videos: act as any demo person through the same routes the pages call.
// Signs in once with the shared demo password and returns a small request function. Local test site only.
import { env } from "./pipeline";

type Method = "GET" | "POST" | "PUT" | "DELETE";

export async function asUser(email: string, loginPath = "/api/site-auth/login") {
  const login = await fetch(`${env.baseUrl}${loginPath}`, {
    method: "POST", headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36" }, body: JSON.stringify({ email, password: env.password }),
  });
  if (!login.ok) throw new Error(`Sign-in as ${email} failed (${login.status})`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return async (method: Method, apiPath: string, body?: unknown) => {
    const r = await fetch(`${env.baseUrl}${apiPath}`, {
      method, headers: { "Content-Type": "application/json", "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36", Cookie: cookie }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    });
    if (!r.ok) throw new Error(`${method} ${apiPath} failed (${r.status}): ${await r.text()}`);
    return r.json() as Promise<any>;
  };
}
