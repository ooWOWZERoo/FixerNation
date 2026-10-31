// Off-camera helper for the lesson-library and standards videos: fills the throwaway test site's lesson catalogue so there is
// something to browse and so the standards research data (which names lessons by exact title) can be loaded.
// The titles and series are the real Fixer Nation lesson names, as the standards research data lists them; the descriptions are
// plain placeholders. Local test site only.
import { sql } from "./pipeline";

const LESSONS: [string, string][] = [
  ["Conflict & Self-Government", "Stay in Control of Your Spirit - Lesson Plan 10 - 23 - #155 - MS"],
  ["Emotional Strength", "Calm Is A Super Power - Lesson Plan 8 - 31 - #116 - MS"],
  ["Conflict & Self-Government", "Pause Before You Escalate - Lesson Plan 10 - 19 - #151 - MS"],
  ["Personal Growth in Action", "Growth Requires Repetition - Lesson Plan 9 - 21 - #131 - MS"],
  ["Responsibility & Ownership", "Learn From Mistakes - Lesson Plan 5 - 22 - #45_MS"],
  ["Communication That Helps", "Say What You Mean With Respect - Lesson Plan: 6 - 8 - #56_MS"],
  ["Respect & Character", "Listen Before You Answer - Lesson Plan: 6 - 3 - #53_MS"],
  ["Respect & Character", "Respect Starts with How You Treat People - Lesson Plan: 6 - 1 - #51_MS"],
  ["Conflict & Self-Government", "Choose Peace Without Losing Strength - Lesson Plan 10 - 20 - #152 - MS"],
  ["Communication That Helps", "Repair Your Words - Lesson Plan: 6 - 11 - #59 - MS"],
  ["Decision Making & Consequences", "Think Past the Moment - Lesson Plan 10 - 5 - #141 - MS"],
  ["Communication That Helps", "Ask for Help the Right Way - Lesson Plan: 6 - 9 - #57_MS"],
  ["Responsibility & Ownership", "Take Responsibility for Your Growth - Lesson Plan 5 - 21 - #44_MS"],
  ["Integrity in Action", "Be Honest Even When It Costs You - Lesson Plan 10 - 14 - #148 - MS"],
  ["Integrity in Action", "Keep Your Word - Lesson Plan 10 - 15 - #149 - MS"],
  ["Integrity in Action", "Do Right When No One Is Watching - Lesson Plan 10 - 12 - #146 - MS"],
  ["Respect & Character", "Be Someone Others Can Trust - Lesson Plan: 6 - 5 - #55 - MS"],
  ["Strength Through Consistency", "Carry Yesterday\u2019s Growth Forward - Lesson Plan 9 - 8 - #122 - MS"],
  ["Teamwork & Community", "Show Up for Others- Lesson Plan: 6 - 22 - #66 - MS"],
  ["Leadership Through Example", "Make Others Better Around You - Lesson Plan 7 - 24 - #90 - MS"],
  ["Teamwork & Community", "Share the Credit - Lesson Plan: 6 - 23 - #67 - MS"],
  ["Self-Control & Daily Choices", "Think Before You Act - Lesson Plan 7 - 6 - #76_MS"],
  ["Teamwork & Community", "Encourage the People Around You - Lesson Plan: 6 - 24 - #68 - MS"],
  ["Healthy Boundaries", "Know Your Limits - Lesson Plan 5 - 8 - #35_MS"],
  ["Confidence & Courage", "Trust Your Growth - Lesson Plan 5 - 1 - #30_MS"],
  ["Gratitude & Perspective", "Notice What Is Good - Lesson Plan 5 - 27 - #48_MS"],
  ["Gratitude & Perspective", "Stop Taking Small Blessings for Granted - Lesson Plan 5 - 28 - #49_MS"],
  ["Decision Making & Consequences", "Count the Cost Before You Choose - Lesson Plan 10 - 9 - #145 - MS"],
  ["Freedom & Responsibility", "Make Choices That Honor Your Future - Lesson Plan 7 - 2 - #74_MS"],
  ["Clarity & Focus", "Slow Down to Think Clearly - Lesson Plan 4 - 17 - #16_MS"],
];
const AUDIENCES = ["Elementary School", "Middle School", "High School"];
const AUDIENCE_BY_SUFFIX: Record<string, string> = { ES: "Elementary School", MS: "Middle School", HS: "High School" };

export function seedLessonCatalog() {
  // The sample lesson that comes with the test site (id 1) is also a real lesson; give it its real title and series.
  sql("UPDATE curricula SET title = 'Take Responsibility for Your Growth', series = 'Responsibility & Ownership' WHERE id = 1");
  LESSONS.filter(([, title]) => title !== "Take Responsibility for Your Growth").forEach(([series, title], i) => {
    const t = title.replace(/'/g, "''"), s = series.replace(/'/g, "''");
    sql(`INSERT INTO curricula (title, series, short_description, overview, published, sort_order) VALUES ('${t}', '${s}', 'A short, guided SEL lesson for your classroom.', 'Students practice one skill through discussion and a short reflection.', 1, ${i + 1})`);
    const id = Number(sql("SELECT MAX(id) FROM curricula"));
    // Each real lesson is one grade version, named with a suffix: ES, MS or HS.
    const level = AUDIENCE_BY_SUFFIX[(title.match(/ - (ES|MS|HS)$/) ?? [])[1]] ?? AUDIENCES[i % 3];
    sql(`INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (${id}, '${level}')`);
  });
}
