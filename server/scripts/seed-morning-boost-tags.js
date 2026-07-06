require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// The Morning Boost tag vocabulary from the step sheet doc, pre-seeded so
// the admin picks from checkboxes instead of retyping ~70 tags by hand.
const TAGS = [
  'Building Confidence',
  'Building Positivity',
  'Celebrate progress',
  'Daily Inspiration',
  'Daily Routine Hacks',
  'Daily Routines',
  'Daily Victories',
  'Decision making',
  'Decision-Making Skills',
  'Delayed Gratification',
  'Discipline & Structure',
  'Discipline and Commitment',
  'Discipline and Focus',
  'Emotional Balance Tips',
  'Emotional Control',
  'Emotional Energy',
  'Emotional Energy Management',
  'Emotional Resilience',
  'Emotional Strength',
  'Empowerment',
  'Empowerment Through Habits',
  'Energy management Tips',
  'Energy Protection',
  'Focus During Challenges',
  'Focus and Productivity',
  'Focus and Wellbeing',
  'Goal Achievement',
  'Growth Mindset',
  'Habit Formation',
  'Handling Challenges',
  'Health and Wellness Routines',
  'Healthy Habits',
  'Inner Circle Wisdom',
  'Inner Strength',
  'Letting go',
  'Long Term Success',
  'Long Term Success Strategies',
  'Mental Clarity',
  'Mental Health',
  'Mental Strength',
  'Mental Wellness',
  'Mental Wellness Tips',
  'Mindful Decision Making',
  'Mindful Living',
  'Mindful Responses',
  'Mindset',
  'Mindset Growth',
  'Mindset Mastery',
  'Momentum Strategies',
  'Motivation vs. Structure',
  'Overcoming Challenges',
  'Overcoming Distractions',
  'Personal Development',
  'Personal Growth Journey',
  'Positive Influences',
  'Positive Self Talk',
  'Prioritization Strategies',
  'Productivity Tips',
  'Resilience',
  'Resilience Building',
  'Routine Refinement',
  'Self-Development',
  'Self-Trust',
  'Staying Calm Under Pressure',
  'Strength Building',
  'Strength Through Adversity',
  'Stress Management',
  'Supportive Relationships',
  'Task Completion',
  'Time Management Tips',
  'Wellness Journey'
];

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  let created = 0, skipped = 0;
  for (const tag of TAGS) {
    const [existing] = await connection.query('SELECT id FROM blog_tags WHERE LOWER(tag) = LOWER(?)', [tag]);
    if (existing.length) {
      skipped++;
      continue;
    }
    await connection.query('INSERT INTO blog_tags (tag) VALUES (?)', [tag]);
    created++;
  }

  console.log(`Done. Created ${created}, skipped ${skipped}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Seeding blog tags failed:', err.message);
  process.exit(1);
});
