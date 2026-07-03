require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Fixer Nation "Morning Boost" lesson plans, bulk-imported as draft curricula.
// Lesson 5-21 (#44, "Take Responsibility for Your Growth") is intentionally
// omitted — it duplicates the already-seeded curriculum id=1.
const LESSONS = [
  { ref: '4-1', theme: `Awareness Builds Strength`, series: `Mental Strength`, objective: `Students will understand that awareness helps them notice their thoughts, choices, habits, and distractions so they can make better decisions, stay calm, and build stronger daily routines.` },
  { ref: '4-2', theme: `Control Your Reactions`, series: `Mental Strength`, objective: `Students will understand that controlling their reactions helps them pause, stay calm, and make better choices when they feel stressed, frustrated, or challenged.` },
  { ref: '4-3', theme: `Discipline Over Emotion`, series: `Mental Strength`, objective: `Students will understand that discipline helps them take positive action, stay focused, and follow through even when they feel tired, distracted, or unmotivated.` },
  { ref: '4-4', theme: `Stay Strong Under Pressure`, series: `Mental Strength`, objective: `Students will understand that staying strong under pressure means pausing, breathing, staying calm, and making thoughtful choices when they face tests, deadlines, challenges, or unexpected situations.` },
  { ref: '4-5', theme: `Focus Creates Results`, series: `Clarity & Focus`, objective: `Students will understand how awareness, focus, and removing distractions help them make better choices, stay calm, and improve their daily habits.` },
  { ref: '4-6', theme: `Eliminate Distractions`, series: `Clarity & Focus`, objective: `Students will understand that eliminating distractions helps them protect their focus, use their time wisely, and stay connected to what matters most.` },
  { ref: '4-7', theme: `Prioritize What Matters`, series: `Clarity & Focus`, objective: `Students will understand that prioritizing what matters helps them choose where to place their time, energy, and attention so they can stay focused, organized, and calm.` },
  { ref: '4-8', theme: `Decision Fatigue`, series: `Clarity & Focus`, objective: `Students will understand that too many choices can make the mind feel tired, and that simple routines, planning ahead, and focusing on what matters can help protect energy and improve decision-making.` },
  { ref: '4-9', theme: `Mental Clutter`, series: `Clarity & Focus`, objective: `Students will understand that mental clutter happens when too many thoughts, worries, tasks, or distractions crowd the mind, and that pausing, breathing, organizing thoughts, and choosing one next step can help create clarity and calm.` },
  { ref: '4-10', theme: `Single-Tasking`, series: `Clarity & Focus`, objective: `Students will understand that single-tasking means doing one thing at a time with focus, patience, and purpose so they can reduce stress, make fewer mistakes, and do their best work.` },
  { ref: '4-11', theme: `Quiet the Noise`, series: `Clarity & Focus`, objective: `Students will understand that quieting the noise means noticing distractions, pressure, overthinking, and unnecessary busyness so they can protect their peace, think clearly, and focus on what matters.` },
  { ref: '4-12', theme: `Protect Your Energy`, series: `Clarity & Focus`, objective: `Students will understand that protecting their energy means noticing what drains them, choosing healthy boundaries, and giving their best attention to what supports focus, peace, and progress.` },
  { ref: '4-13', theme: `Guard Your Mind`, series: `Clarity & Focus`, objective: `Students will understand that guarding their mind means paying attention to thoughts, messages, and influences so they can protect their peace, focus, confidence, and daily choices.` },
  { ref: '4-14', theme: `Intentional Thinking`, series: `Clarity & Focus`, objective: `Students will understand that intentional thinking means noticing their thoughts, asking helpful questions, and choosing thoughts that support peace, focus, growth, and better choices.` },
  { ref: '4-15', theme: `Choose Your Response`, series: `Clarity & Focus`, objective: `Students will understand that self-control, emotional awareness, and responsible decision-making help them respond with wisdom instead of reacting out of frustration, stress, or pressure. Students will learn how pausing, breathing, and thinking clearly can help them make better choices.` },
  { ref: '4-16', theme: `Slow Down to Think Clearly`, series: `Clarity & Focus`, objective: `Students will understand that slowing down is not weakness; it is wisdom. Students will learn how pausing, breathing, resetting, and choosing a steady pace can help them make better decisions, protect their peace, and improve focus.` },
  { ref: '4-17', theme: `Stay Present`, series: `Clarity & Focus`, objective: `Students will understand that presence is a choice that helps them stop drifting, manage distractions, and focus on what is in front of them. Students will learn how pausing, breathing, and returning their attention to the present moment can support better choices, stronger focus, and greater peace.` },
  { ref: '4-18', theme: `One Next Step`, series: `Clarity & Focus`, objective: `Students will understand that they do not need to solve everything at once. Students will learn how slowing down, simplifying their thoughts, and choosing one wise next step can help them move from pressure to progress.` },
  { ref: '4-19', theme: `Follow Through`, series: `Clarity & Focus`, objective: `Students will understand that follow-through turns good intentions into real progress. Students will learn how staying steady, completing important tasks, and honoring commitments can help them build discipline, trust, and stronger decision-making.` },
  { ref: '4-20', theme: `Stay Consistent`, series: `Clarity & Focus`, objective: `Students will understand that lasting progress is built through consistency, not one-time effort. Students will learn how repeating good choices, returning to what matters, and staying steady can help them build stronger habits and better focus.` },
  { ref: '4-21', theme: `Protect Your Progress`, series: `Clarity & Focus`, objective: `Students will understand that progress is valuable and needs to be protected. Students will learn how awareness, discipline, healthy routines, and wise choices can help them keep moving forward with focus, peace, and purpose.` },
  { ref: '4-22', theme: `Finish Strong`, series: `Clarity & Focus`, objective: `Students will understand that finishing strong builds discipline, confidence, and trust. Students will learn how staying present, paying attention to the last step, and completing what matters with care can protect the progress they have already made.` },
  { ref: '4-23', theme: `Live With Clarity`, series: `Clarity & Focus`, objective: `Students will understand that clarity is not just one thought or one decision; it is a way of living. Students will learn how staying present, choosing one next step, following through, protecting progress, and returning to what matters can help them move forward with peace and purpose.` },
  { ref: '4-24', theme: `Know What Matters`, series: `Purpose & Direction`, objective: `Students will understand that direction becomes stronger when values and priorities become clearer. Students will learn how identifying what matters most can help them make wiser choices, protect their time, guard their energy, and live with greater purpose.` },
  { ref: '4-25', theme: `Choose Your Priorities`, series: `Purpose & Direction`, objective: `Students will understand that purpose becomes stronger when they choose their priorities instead of letting pressure, distractions, or urgency choose for them. Students will learn how protecting what matters first can help build focus, peace, direction, and responsibility.` },
  { ref: '4-26', theme: `Stop Drifting`, series: `Purpose & Direction`, objective: `Students will understand that drifting happens when attention, habits, time, or choices move away from what matters most. Students will learn how honest awareness, small corrections, and purposeful choices can help them return to direction and make stronger decisions.` },
  { ref: '4-27', theme: `Be Led by Purpose`, series: `Purpose & Direction`, objective: `Students will understand that purpose gives direction to their choices and helps them decide what matters most. Students will learn how being led by purpose can help them say yes with wisdom, say no with peace, and make choices that match the person they are becoming.` },
  { ref: '4-28', theme: `Align Your Actions`, series: `Purpose & Direction`, objective: `Students will understand that actions should support values, priorities, and purpose. Students will learn how honest reflection, small adjustments, and responsible choices can help them build trust, strengthen direction, and support the future they want to build.` },
  { ref: '4-29', theme: `Live On Purpose`, series: `Purpose & Direction`, objective: `Students will understand that living on purpose means making choices with awareness instead of moving through the day on autopilot. Students will learn how aligning time, attention, habits, and actions with their values can help them build direction, confidence, and a stronger future.` },
  { ref: '5-1', theme: `Trust Your Growth`, series: `Confidence & Courage`, objective: `Students will understand that growth does not always happen quickly or dramatically. They will learn to recognize progress, avoid comparison, respect small steps, and build confidence by trusting what is being developed inside them.` },
  { ref: '5-2', theme: `Speak With Confidence`, series: `Confidence & Courage`, objective: `Students will understand that their voice has value. They will learn that speaking with confidence means choosing words wisely, sharing ideas clearly, asking for help when needed, setting healthy boundaries, and speaking truth with kindness and maturity.` },
  { ref: '5-5', theme: `Believe You Can Learn`, series: `Confidence & Courage`, objective: `Students will understand that not knowing something yet does not mean they cannot learn it. They will learn to see mistakes as part of growth, stay patient during challenges, avoid giving up too quickly, and keep practicing with confidence and courage.` },
  { ref: '5-6', theme: `Stand Tall Under Pressure`, series: `Confidence & Courage`, objective: `Students will understand that pressure does not have to control their actions. They will learn to pause, breathe, steady themselves, and choose responses that reflect strength, wisdom, respect, and responsibility.` },
  { ref: '5-7', theme: `Walk in Quiet Confidence`, series: `Confidence & Courage`, objective: `Students will understand that confidence grows when they trust their growth, keep their word, stay grounded under pressure, and avoid letting fear or comparison control how they carry themselves.` },
  { ref: '5-8', theme: `Know Your Limits`, series: `Healthy Boundaries`, objective: `Students will understand that knowing their limits is not weakness. They will learn that paying attention to stress, tiredness, overload, and the need for help or rest can help them make stronger, healthier decisions.` },
  { ref: '5-11', theme: `Say No With Wisdom`, series: `Healthy Boundaries`, objective: `Students will understand that they do not have to say yes to everything to be kind, accepted, or responsible. They will learn that wise boundaries help protect their peace, focus, time, choices, and long-term growth.` },
  { ref: '5-12', theme: `Stop Overcommitting`, series: `Healthy Boundaries`, objective: `Students will understand that healthy boundaries include choosing what they can handle well. They will learn that wisdom means slowing down, noticing pressure, protecting their peace, and focusing on what matters most.` },
  { ref: '5-13', theme: `Step Back Without Guilt`, series: `Healthy Boundaries`, objective: `Students will understand that stepping back does not mean quitting, being unkind, or letting people down. They will learn that a wise pause can help them protect their peace, reset their thinking, and choose a healthier response.` },
  { ref: '5-14', theme: `Honor Your Capacity`, series: `Healthy Boundaries`, objective: `Students will understand that honoring their capacity does not mean they are weak or selfish. They will learn to notice when pressure is building, choose one wise next step, ask for help when needed, and protect their peace with healthy boundaries.` },
  { ref: '5-15', theme: `Own Your Choices`, series: `Responsibility & Ownership`, objective: `Students will understand that they may not control everything that happens around them, but they can take responsibility for how they respond. They will learn to pause before blaming, tell the truth about mistakes, learn from them, and choose the next right step.` },
  { ref: '5-18', theme: `Stop Making Excuses`, series: `Responsibility & Ownership`, objective: `Students will understand the difference between a reason and an excuse. They will learn that excuses can keep them from learning, correcting, and growing, while responsibility helps them tell the truth, ask for help, make a better plan, and choose the next right step.` },
  { ref: '5-19', theme: `Be Honest With Yourself`, series: `Responsibility & Ownership`, objective: `Students will understand that being honest with themselves is not about shame or being mean to themselves. It is about courage, responsibility, and growth. Students will learn that they cannot improve what they refuse to notice, and that honesty helps them ask for help, make better choices, and move forward.` },
  { ref: '5-20', theme: `Do What Needs to Be Done`, series: `Responsibility & Ownership`, objective: `Students will understand that responsibility does not wait for perfect feelings or perfect timing. They will learn that doing what needs to be done builds trust, discipline, dependability, and courage. Students will practice identifying one responsibility, taking one step, and choosing action over delay.` },
  // 5-21 (#44) intentionally skipped — duplicate of the already-seeded
  // "Responsibility & Ownership: Take Responsibility for Your Growth" curriculum.
  { ref: '5-22', theme: `Learn From Mistakes`, series: `Responsibility & Ownership`, objective: `Students will understand that mistakes are part of learning and growth. They will learn that a mistake is not their identity; it is information that can show them what needs attention, what needs practice, and what better choice can be made next time.` },
  { ref: '5-25', theme: `Remember the Sacrifice`, series: `Gratitude & Perspective`, objective: `Students will understand that Memorial Day is a time to remember the men and women who gave their lives while serving our country. They will learn that sacrifice deserves respect, quiet gratitude, and better perspective, and that kindness, responsibility, and wise choices are ways to honor what others gave.` },
  { ref: '5-26', theme: `Build a Reputation You Respect`, series: `Responsibility & Ownership`, objective: `Students will understand that reputation is built through repeated choices, not one-time words. They will learn that how they speak, treat others, handle mistakes, and follow through on responsibilities helps build trust, respect, confidence, and character.` },
  { ref: '5-27', theme: `Notice What Is Good`, series: `Gratitude & Perspective`, objective: `Students will understand that gratitude does not mean pretending life is perfect. They will learn that gratitude helps them notice what is still good while they work through challenges, mistakes, delays, or frustrations with a calmer and stronger mindset.` },
  { ref: '5-28', theme: `Stop Taking Small Blessings for Granted`, series: `Gratitude & Perspective`, objective: `Students will understand that small blessings, such as kind words, clean water, food, help from others, a safe place to learn, and a new morning, should not be ignored. They will learn that appreciation helps strengthen patience, respect, kindness, and perspective.` },
  { ref: '5-29', theme: `Reset Your Mind`, series: `Renewal & New Energy`, objective: `Students will understand that resetting their mind is not pretending everything is easy. It means noticing when thoughts are moving in the wrong direction and choosing a stronger, healthier focus. Students will learn to use a pause, a breath, and one better thought to help protect their peace and attitude.` },
  { ref: '6-1', theme: `Respect Starts With How You Treat People`, series: `Respect & Character`, objective: `In today's Morning Boost, students learn that respect begins with the way they treat people. This lesson helps students practice respectful words, careful listening, kind actions, and choices that build stronger character and healthier relationships.` },
  { ref: '6-2', theme: `Use Words That Build`, series: `Respect & Character`, objective: `Students will understand that choosing respectful, helpful, and kind words can build stronger relationships, better trust, and stronger character.` },
  { ref: '6-3', theme: `Listen Before You Answer`, series: `Respect & Character`, objective: `Students will understand that listening before answering can help them show respect, understand the full message, and choose responses that are calm, kind, and wise.` },
  { ref: '6-4', theme: `Choose Kindness When It Is Not Easy`, series: `Respect & Character`, objective: `Students will understand that choosing kindness in difficult moments helps them respond with respect, control their words, and build character people can trust.` },
  { ref: '6-5', theme: `Be Someone Others Can Trust`, series: `Respect & Character`, objective: `Students will understand that being trustworthy means making choices that show honesty, respect, responsibility, and willingness to grow.` },
  { ref: '6-8', theme: `Say What You Mean with Respect`, series: `Communication That Helps`, objective: `Students will understand that respectful communication means choosing words that help others understand what they mean while showing self-control and kindness.` },
  { ref: '6-9', theme: `Ask for Help the Right Way`, series: `Communication That Helps`, objective: `Students will understand that asking for help the right way means using respectful words, listening carefully, and staying willing to learn.` },
  { ref: '6-10', theme: `Explain Instead of Blame`, series: `Communication That Helps`, objective: `Students will understand that explaining instead of blaming means telling the truth respectfully, taking responsibility, and choosing words that help solve the problem.` },
  { ref: '6-11', theme: `Repair Your Words`, series: `Communication That Helps`, objective: `Students will understand that repairing words means noticing when words do not help, taking responsibility, and choosing calmer, more respectful words next.` },
  { ref: '6-12', theme: `Speak Life into the Room`, series: `Communication That Helps`, objective: `Students will understand that speaking life means choosing words that help, build, and show respect, even when they need to tell the truth or handle a difficult moment.` },
  { ref: '6-15', theme: `Name the Real Issue`, series: `Problem Solving & Wise Choices`, objective: `Students will understand that naming the real issue helps them stop guessing, blaming, or reacting, and helps them choose a wiser next step.` },
  { ref: '6-16', theme: `Look for the Answer`, series: `Problem Solving & Wise Choices`, objective: `Students will identify the main message of the Morning Boost and explain how looking for the answer can help them solve problems with wisdom, responsibility, and respect.` },
  { ref: '6-17', theme: `Break the Problem Down`, series: `Problem Solving & Wise Choices`, objective: `Students will understand that breaking a problem into smaller parts can help them stop feeling overwhelmed, think clearly, and choose a responsible next step.` },
  { ref: '6-18', theme: `Choose the Better Option`, series: `Problem Solving & Wise Choices`, objective: `Students will understand that choosing the better option means picking the response that is helpful, respectful, and responsible, even when it is not the easiest choice.` },
  { ref: '6-19', theme: `Keep Moving Toward the Solution`, series: `Problem Solving & Wise Choices`, objective: `Students will understand that solving problems takes steady effort, honest thinking, respectful choices, and the courage to keep taking the next wise step.` },
  { ref: '6-22', theme: `Show Up for Others`, series: `Teamwork & Community`, objective: `Students will understand that showing up for others means choosing respect, effort, kindness, and responsibility so the group can become stronger.` },
  { ref: '6-23', theme: `Share the Credit`, series: `Teamwork & Community`, objective: `Students will understand that sharing credit builds trust, respect, and teamwork by helping everyone feel seen, valued, and encouraged to keep contributing.` },
  { ref: '6-24', theme: `Encourage the People Around You`, series: `Teamwork & Community`, objective: `Students will understand that encouraging others builds trust, kindness, and teamwork by helping people feel supported and valued.` },
  { ref: '6-25', theme: `Help Without Taking Over`, series: `Teamwork & Community`, objective: `Students will understand that respectful help builds confidence, trust, and teamwork by supporting others without controlling their choices or doing everything for them.` },
  { ref: '6-26', theme: `Make the Group Stronger`, series: `Teamwork & Community`, objective: `Students will understand that they can strengthen their classroom, team, family, or community by adding respect, effort, encouragement, and responsible choices.` },
  { ref: '6-29', theme: `Carry the Good Forward`, series: `Positive Momentum`, objective: `Students will understand that they can build positive momentum by repeating good choices, remembering helpful lessons, and choosing one steady step forward at a time.` },
  { ref: '6-30', theme: `Start the Next Month Strong`, series: `Positive Momentum`, objective: `Students will understand that a strong start begins with remembering what helped them grow, choosing one wise next step, and carrying positive habits forward.` },
];

const AUDIENCES = ['Elementary School', 'Middle School'];
const DOWNLOAD_LIMIT = 3;

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const lesson of LESSONS) {
    const title = `${lesson.series}: ${lesson.theme}`;
    try {
      const [existing] = await connection.query('SELECT id FROM curricula WHERE title = ?', [title]);
      if (existing.length) {
        console.log(`[${lesson.ref}] Skipped (already exists): ${title}`);
        skipped++;
        continue;
      }

      await connection.beginTransaction();
      const [result] = await connection.query(
        `INSERT INTO curricula (title, series, short_description, overview, estimated_duration, download_limit, published)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [title, 'SEL Morning Boost', lesson.objective, lesson.objective, '', DOWNLOAD_LIMIT, 0]
      );
      const id = result.insertId;
      await connection.query(
        'INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES ' + AUDIENCES.map(() => '(?, ?)').join(', '),
        AUDIENCES.flatMap(a => [id, a])
      );
      await connection.commit();
      console.log(`[${lesson.ref}] Created (id ${id}): ${title}`);
      created++;
    } catch (err) {
      await connection.rollback();
      console.error(`[${lesson.ref}] FAILED: ${title} — ${err.message}`);
      failed++;
    }
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped} (already existed), failed ${failed}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Bulk import failed:', err.message);
  process.exit(1);
});
