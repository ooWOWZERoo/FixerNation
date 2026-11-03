// Demo community for the M1 to M4 videos: a few groups, posts from the other Maple teachers, comments, likes, an unread
// direct message and two profiles. Everything is fictional (example.com addresses). Written straight into the throwaway test
// database (never production), the same way catalog.ts adds lessons. Maria Lopez is the teacher on camera.
import { spawnSync } from "child_process";
import { createRequire } from "module";
import fs from "fs";
import os from "os";
import path from "path";
import { sql } from "./pipeline";

const ffmpeg = createRequire(__filename)("ffmpeg-static") as string;
const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const email = (first: string, last: string) => `${first}.${last}@maple.example.com`.toLowerCase();
const uid = (e: string) => Number(sql(`SELECT id FROM site_users WHERE email=${q(e)}`));

function addGroup(name: string, type: string, description: string, domain?: string): number {
  sql(`INSERT INTO social_groups (name, type, description, is_public, school_domain) VALUES (${q(name)}, ${q(type)}, ${q(description)}, 1, ${domain ? q(domain) : "NULL"})`);
  return Number(sql(`SELECT id FROM social_groups WHERE name=${q(name)} ORDER BY id DESC LIMIT 1`));
}
const join = (groupId: number, userId: number) => sql(`INSERT IGNORE INTO social_group_members (group_id, user_id) VALUES (${groupId}, ${userId})`);
function post(groupId: number, authorId: number, content: string, hoursAgo: number): number {
  sql(`INSERT INTO social_posts (group_id, author_id, content, created_at) VALUES (${groupId}, ${authorId}, ${q(content)}, NOW() - INTERVAL ${hoursAgo} HOUR)`);
  return Number(sql(`SELECT MAX(id) FROM social_posts`));
}
const comment = (postId: number, authorId: number, content: string, hoursAgo: number) =>
  sql(`INSERT INTO social_comments (post_id, author_id, content, created_at) VALUES (${postId}, ${authorId}, ${q(content)}, NOW() - INTERVAL ${hoursAgo} HOUR)`);
const like = (postId: number, userId: number) => sql(`INSERT IGNORE INTO social_reactions (post_id, user_id, reaction) VALUES (${postId}, ${userId}, 'like')`);
const markRead = (groupId: number, userId: number, hoursAgo: number) =>
  sql(`INSERT INTO social_group_reads (group_id, user_id, last_read_at) VALUES (${groupId}, ${userId}, NOW() - INTERVAL ${hoursAgo} HOUR) ON DUPLICATE KEY UPDATE last_read_at = VALUES(last_read_at)`);

export interface CommunityOptions {
  /** Maria is already a member of these custom groups (she can still browse and add the others). */
  mariaIn?: string[];
  /** James has sent Maria a direct message she has not read yet. */
  unreadDm?: boolean;
}

export function seedCommunity(opts: CommunityOptions = {}) {
  const maria = uid(email("maria", "lopez"));
  const james = uid(email("james", "okafor"));
  const priya = uid(email("priya", "shah"));
  const ethan = uid(email("ethan", "brooks"));
  const hannah = uid(email("hannah", "weiss"));
  const luis = uid(email("luis", "ortega"));
  const teachers = [maria, james, priya, ethan, hannah, luis];

  // The two groups every teacher gets when they join through an invitation
  const everyone = addGroup("All Teachers", "all_teachers", "Every licensed Fixer Nation teacher.");
  const maple = addGroup("Maple Elementary", "school", "Teachers at Maple Elementary.", "maple.example.com");
  teachers.forEach((t) => { join(everyone, t); join(maple, t); });

  // Public groups an admin created
  const mgmt = addGroup("Classroom Management Ideas", "custom", "Routines, transitions and calm-down ideas that work.");
  const boost = addGroup("Morning Boost Tips", "custom", "How teachers fit Morning Boost into the school day.");
  const sel = addGroup("Teaching Social-Emotional Skills", "custom", "Share what is working for your students.");
  [james, priya, ethan, hannah].forEach((t) => join(mgmt, t));
  [priya, hannah, luis].forEach((t) => join(boost, t));
  [james, ethan, luis].forEach((t) => join(sel, t));
  const byName: Record<string, number> = { "Classroom Management Ideas": mgmt, "Morning Boost Tips": boost, "Teaching Social-Emotional Skills": sel };
  (opts.mariaIn ?? []).forEach((n) => join(byName[n], maria));

  // Posts
  const p1 = post(maple, james, "Our grade 4 team is trying a two-minute calm-down break right after lunch. Has anyone at Maple tried something similar? #classroommanagement", 30);
  const p2 = post(maple, priya, "Today's Morning Boost lesson sparked a great talk about taking responsibility. My class asked to do another one tomorrow. #morningboost", 5);
  const p3 = post(mgmt, priya, "Transition tip: a visual timer on the board cut our lining-up time in half. Students like beating the clock together. #classroommanagement", 26);
  const p4 = post(mgmt, hannah, "Here is a one-page routine chart I use for the first week back from break: https://example.com/routine-chart #routines", 9);
  const p5 = post(boost, hannah, "I run Morning Boost right after the bell while students settle. It takes about ten minutes and sets the tone for the day.", 12);
  const p6 = post(sel, luis, "We close each day with one sentence: \"Today I handled a hard moment by...\" The answers have been surprisingly honest. #sel", 20);
  comment(p1, priya, "We do a quiet minute with soft music. Ten days in, the afternoons feel calmer.", 28);
  comment(p1, ethan, "Please share how it goes. I would like to try it with my grade 5 class.", 27);
  comment(p3, james, "Love this. Does the timer ever stress anyone out?", 24);
  comment(p3, priya, "Not so far, we do it as a team challenge, not a race between students.", 23);
  [james, ethan, luis].forEach((u) => like(p2, u));
  [priya, ethan].forEach((u) => like(p1, u));
  [james, hannah, ethan].forEach((u) => like(p3, u));
  like(p6, james);

  // Maria last looked two days ago, so her groups show unread counts
  [everyone, maple, ...(opts.mariaIn ?? []).map((n) => byName[n])].forEach((g) => markRead(g, maria, 48));

  if (opts.unreadDm) {
    sql(`INSERT INTO social_messages (sender_id, recipient_id, content, created_at) VALUES (${james}, ${maria}, ${q("Hi Maria, could I borrow your calm-down slides from Friday? Our team wants to try them next week.")}, NOW() - INTERVAL 3 HOUR)`);
  }

  // Priya has shared a bio (she checked the consent box); James has not
  sql(`INSERT INTO social_profiles (user_id, bio, bio_consent) VALUES (${priya}, ${q("I teach grade 3 at Maple Elementary. I use Morning Boost to start the day and love swapping routines with other teachers.")}, 1) ON DUPLICATE KEY UPDATE bio = VALUES(bio), bio_consent = 1`);
}

/** A plain green-to-gold picture to attach to a post, made with ffmpeg, so no stock photo or real student appears. */
export function makeDemoPhoto(): string {
  const file = path.join(os.tmpdir(), "fne-howto-anchor-chart.png");
  const r = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", "gradients=s=900x560:c0=0x164F4A:c1=0xEBA657:x0=0:y0=0:x1=900:y1=560:n=2", "-frames:v", "1", file], { encoding: "utf8" });
  if (r.status !== 0 || !fs.existsSync(file)) throw new Error(`Could not make the demo photo: ${r.stderr?.slice(-400)}`);
  return file;
}
