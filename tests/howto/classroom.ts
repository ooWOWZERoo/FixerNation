// Off-camera helpers for the teacher, student and parent videos: build the demo classroom and the students' work through the same
// routes the pages call (teacher signs in with the site login, students with username and PIN). Local test site only.
// Every name is made up.
import { env } from "./pipeline";
import { asUser } from "./api";

export const STUDENTS = [
  { name: "Alex Johnson", username: "alex", pin: "482019" },
  { name: "Sam Lee", username: "sam", pin: "250135" },
  { name: "Jordan Smith", username: "jordan", pin: "947699" },
  { name: "Taylor Kim", username: "taylor", pin: "607155" },
];

export async function asStudent(username: string, pin: string) {
  const login = await fetch(`${env.baseUrl}/api/classroom-auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, pin }),
  });
  if (!login.ok) throw new Error(`Student sign-in as ${username} failed (${login.status})`);
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  return async (method: "GET" | "POST" | "PUT" | "DELETE", p: string, body?: unknown) => {
    const r = await fetch(`${env.baseUrl}${p}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: method === "GET" ? undefined : JSON.stringify(body ?? {}) });
    if (!r.ok) throw new Error(`${method} ${p} failed (${r.status}): ${await r.text()}`);
    return r.json() as Promise<any>;
  };
}

export interface Seeded { id: number; joinCode: string; lessonId: number; gameId: number; gameAssignmentId?: number; }

/**
 * Creates "Period 3 SEL" for the demo teacher with the four made-up students. Options:
 *  assign  - assign the one published lesson and one brain game
 *  activity - the students do some of the work (needs assign): Alex finishes the lesson with a full quiz and both reflections,
 *             Sam finishes with one quiz answer wrong, Jordan has only started, Taylor has done nothing. Alex and Sam also finish the game.
 */
export async function seedClassroom(opts: { assign?: boolean; activity?: boolean } = {}): Promise<Seeded> {
  const teacher = await asUser(env.teacher);
  const room = await teacher("POST", "/api/classrooms", { name: "Period 3 SEL", gradeLevel: "6th Grade", subject: "Social-Emotional Learning", academicYear: "2026–2027" });
  for (const s of STUDENTS) await teacher("POST", `/api/classrooms/${room.id}/students`, { displayName: s.name, pin: s.pin });
  const out: Seeded = { id: room.id, joinCode: room.join_code, lessonId: 1, gameId: 5 };
  if (!opts.assign) return out;

  await teacher("POST", `/api/classrooms/${room.id}/assignments`, { curriculumId: out.lessonId });
  const ga = await teacher("POST", `/api/classrooms/${room.id}/game-assignments`, { gameId: out.gameId });
  out.gameAssignmentId = ga.id;
  if (!opts.activity) return out;

  const doLesson = async (s: (typeof STUDENTS)[number], wrongOnQuiz: boolean, finish: boolean) => {
    const api = await asStudent(s.username, s.pin);
    await api("POST", `/api/student/lesson/${out.lessonId}/start`);
    if (!finish) return api;
    await api("POST", `/api/student/lesson/${out.lessonId}/reflect`, { promptKey: "pre_lesson", responseText: "I think taking responsibility means owning up when I make a mistake." });
    const lesson = await api("GET", `/api/student/lesson/${out.lessonId}`);
    const qs: any[] = lesson.quiz ?? lesson.questions ?? lesson.quizQuestions ?? [];
    const answers = qs.map((q: any, i: number) => ({ questionId: q.id, selectedOptionIndex: wrongOnQuiz && i === 0 ? ((q.correctIndex ?? q.correct_index ?? 0) + 1) % 2 : (q.correctIndex ?? q.correct_index ?? 0) }));
    if (answers.length) await api("POST", `/api/student/lesson/${out.lessonId}/quiz`, { answers });
    await api("POST", `/api/student/lesson/${out.lessonId}/reflect`, { promptKey: "post_lesson", responseText: wrongOnQuiz ? "Next time I will ask for help sooner." : "I learned that small choices add up to big growth." });
    await api("POST", `/api/student/lesson/${out.lessonId}/complete`);
    return api;
  };
  const alex = await doLesson(STUDENTS[0], false, true);
  const sam = await doLesson(STUDENTS[1], true, true);
  await doLesson(STUDENTS[2], false, false);
  await alex("POST", `/api/student/games/${ga.id}/complete`, { rawScore: 8, durationMs: 95000 });
  await sam("POST", `/api/student/games/${ga.id}/complete`, { rawScore: 6, durationMs: 120000 });
  return out;
}
