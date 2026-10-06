// Replaces the "Materials Needed" list for every row in curricula with one
// fixed, shared set of generic lesson-plan usage instructions (requested
// 2026-10-06) -- this is a content decision, not a per-lesson materials
// list anymore. Safe to re-run: always deletes a curriculum's existing
// curriculum_materials rows and reinserts the same fixed list, so the end
// state converges no matter how many times this runs.
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../db/pool');

const MATERIALS = [
  'Fixer Nation Education — Lesson Plan Educational Instructions',
  '',
  'Fixer Nation Morning Boost is designed to be a flexible, educator-led resource. Educators may adapt each lesson to their instructional style, classroom schedule, students’ developmental needs, and available instructional time. Use the following recommendations to establish a consistent routine that supports positive reflection, wellness, character development, social-emotional learning, and readiness to learn.',
  '',
  'Preview the lesson before presenting it. Review the Morning Boost video, student handout, teacher handout, quiz, classroom poster, and discussion prompts in advance so you can determine the most appropriate way to integrate the lesson into your classroom and address the needs of your students.',
  'Choose the presentation method that works best for your classroom. Play the Morning Boost video, present the audio, read the lesson aloud, or have students follow along using the student handout. Educators may combine these methods when doing so improves student engagement or accessibility.',
  'Use Google Chrome Live Caption when appropriate. When students watch the Morning Boost video on individual computers or Chromebooks, Google Chrome Live Caption may be used to display spoken content as captions on the student’s screen when the feature is available and supported by the school’s technology environment. Follow your school’s accessibility, technology, and student privacy policies.',
  'Provide appropriate accessibility and learning accommodations. Adapt presentation methods, pacing, reading support, response options, and classroom activities as appropriate for students with IEPs, 504 Plans, English-language learning needs, disabilities, or other documented accommodations. Follow all applicable school and district requirements.',
  'Adapt the lesson to your available classroom time. The Morning Boost may be used as a complete lesson or divided into shorter activities throughout the day. Educators may select the video, discussion, reflection, affirmation, handout, quiz, or personal-goal activity that best supports their instructional objectives and available time.',
  'Follow the recommended learning sequence when time permits. Guide students through five simple steps: watch or listen to the lesson, discuss its message, reflect on its personal meaning, complete the short quiz, and select an affirmation, goal, healthy habit, or positive action to practice.',
  'Encourage age-appropriate classroom discussion. Use the lesson’s guiding questions to help students connect the message to their choices, behavior, relationships, wellness, decision-making, and self-management. Keep conversations respectful, constructive, inclusive, and appropriate for your students’ developmental level.',
  'Provide different ways for students to participate. Allow students to contribute by speaking, writing, completing the handout, taking the quiz, participating in small-group discussion, or reflecting privately. Students should never be required to publicly disclose sensitive, private, or personal experiences.',
  'Use the student handout to strengthen understanding. Guide students through the lesson objective, reflection questions, affirmation, and related activities. The handout may be completed independently, in small groups, or as part of an educator-led classroom exercise.',
  'Use the short quiz as instructional feedback. Review quiz results to identify which students understand the lesson and which concepts may require additional explanation, discussion, or reinforcement. The quiz is intended to support learning and growth and should not be used to embarrass, label, diagnose, or punish students.',
  'Use the Fixer Nation Education Digital Classroom when available. Assign lessons and quizzes through the Student Portal and review available information regarding student participation, quiz results, reflections, personal goals, and progress. Use this information to guide follow-up instruction, reinforce key concepts, and recognize student growth.',
  'Display the classroom poster during the lesson. Place the lesson poster in a visible classroom location while presenting and reviewing the Morning Boost. Refer to the lesson theme, key message, learning points, and affirmation during the lesson and throughout the school day.',
  'Keep the classroom poster displayed until the next lesson. When presenting a new lesson plan, replace the previous poster with the new lesson poster. Save previous posters so they can be revisited when their messages relate to future lessons, classroom situations, student goals, or instructional needs.',
  'Reinforce the lesson throughout the day. Refer back to the Morning Boost when natural opportunities arise during classroom instruction, group work, transitions, problem-solving, conflict resolution, decision-making, goal setting, or student reflection.',
  'Encourage students to select a positive action. Ask students to identify one affirmation, personal goal, healthy habit, responsible choice, or constructive action they can practice during the day. Follow up when appropriate so students can recognize progress and connect daily actions to personal growth.',
  'Recognize progress rather than perfection. Celebrate student effort, thoughtful reflection, responsible choices, respectful communication, healthy habits, perseverance, and consistent growth. Reinforce the idea that meaningful improvement is often built through small, repeated actions.',
  'Respond appropriately when a lesson raises a student concern. If a discussion, reflection, or student response suggests that a student may need additional academic, emotional, behavioral, health, or safety support, follow your school’s established procedures for involving the appropriate counselor, administrator, support professional, parent, or guardian.',
  'Invite parents and guardians to participate. Assign participating families a Fixer Nation Education Parent PIN and provide instructions for accessing the appropriate parent and family resources. Encourage families to discuss the lesson, affirmation, personal goal, or positive action at home.',
  'Help families continue the conversation at home. Families may watch Morning Boost videos together and discuss how the lesson applies to daily life. Encourage parents and guardians to ask what their child learned, which positive action they selected, what progress they noticed, and how the lesson’s message can be practiced at home.',
  'Protect student and family information. Remind families to protect their Parent PIN, student login information, passwords, and account credentials. Classroom and family participation should follow applicable school, district, and student-data privacy requirements.',
  'Introduce parents and guardians to the Fixer Nation Positivity, Health & Wellness Network. Share www.FixerNation.org as an optional positivity, health, wellness, and personal-growth resource for adults, children, and families. Explain that Fixer Nation is designed to encourage healthier choices, meaningful personal growth, purposeful online activity, and supportive connections.',
  'Share the additional family resources available through Fixer Nation. Parents and guardians may explore Morning Boost content, books, blogs, positive community resources, interactive Brain Builder activities, the vetted provider directory, and other personal-growth, positivity, health, and wellness resources.',
  'Keep participation in the broader public network optional and separate from coursework. Direct students primarily to the school-approved Fixer Nation Education Student Portal for assigned educational activities. Participation in the broader Fixer Nation Positivity, Health & Wellness Network should remain separate from required classroom work and should occur only with appropriate parent or guardian permission and in accordance with applicable school policies.',
  'Use the Morning Boost as a positive transition into learning. A brief, consistent Morning Boost routine can help students settle into the school day, direct their attention toward constructive thinking, reflect on healthy choices, and prepare mentally and emotionally for learning.',
  'Connect the Morning Boost to academic readiness. The goal is not only to support social-emotional learning and character development, but also to help students enter instruction with greater focus, self-awareness, emotional regulation, and readiness to learn. A thoughtful beginning to the day can support the conditions that contribute to stronger attention, engagement, comprehension, retention, and recall.',
  'Keep the overall purpose in focus. Fixer Nation Morning Boost is designed to help students strengthen important life skills through consistent practice and reinforcement while preparing their minds for the learning ahead. The goal is to help students become more thoughtful, responsible, resilient, healthy, self-aware, and prepared to make positive choices throughout the school day and beyond.',
];

async function main() {
  const [curricula] = await pool.query('SELECT id FROM curricula');
  console.log(`Found ${curricula.length} curricula.`);

  for (const { id } of curricula) {
    await pool.query('DELETE FROM curriculum_materials WHERE curriculum_id = ?', [id]);
    for (let i = 0; i < MATERIALS.length; i++) {
      await pool.query(
        'INSERT INTO curriculum_materials (curriculum_id, material, sort_order) VALUES (?, ?, ?)',
        [id, MATERIALS[i], i]
      );
    }
    console.log(`Curriculum ${id}: replaced materials (${MATERIALS.length} rows).`);
  }

  console.log('Done.');
  await pool.end();
}

main().catch(err => {
  console.error('reset-curriculum-materials failed:', err.message);
  process.exit(1);
});
