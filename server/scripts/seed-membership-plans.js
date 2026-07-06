require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// The 7 real membership tiers across the 3 member types. Pricing/copy taken
// directly from fixernation.org/join-fixer-nation (consumer) and the
// service-provider/brand-ambassador pricing screenshots provided when this
// feature was scoped — not placeholders. Benefits are one bullet per line.
const CONSUMER_BENEFITS = [
  'Fixer Nation Positivity Health and Wellness Social Network',
  'Daily Fixer Nation Morning Boost Emails',
  'Fixer Nation Vetted Professional Network',
  'Ask The Fixer direct help service',
  'Fixer Nation Positivity Health and Wellness Blog',
  'Fixer Nation Positivity Health and Wellness Library',
  'Fixer Nation Mobile app',
].join('\n');

const PLANS = [
  {
    name: 'Free w/ Book Purchase',
    memberType: 'consumer',
    price: 0,
    regularPrice: null,
    billingInterval: 'one_time',
    trialDays: 0,
    durationDays: 90,
    description: 'Receive a 90-day membership to the Fixer Nation Positivity Health and Wellness Network with any Fixer Nation Issues and Answers book purchase, using the QR code on the inside cover of your book.',
    benefits: CONSUMER_BENEFITS,
  },
  {
    name: 'Fixer Nation Monthly Membership',
    memberType: 'consumer',
    price: 7,
    regularPrice: 10,
    billingInterval: 'monthly',
    trialDays: 30,
    durationDays: 30,
    description: 'Put your Positivity, Health and Wellness plan into action — take advantage of our introductory offer today.',
    benefits: CONSUMER_BENEFITS,
  },
  {
    name: 'Fixer Nation Annual Membership',
    memberType: 'consumer',
    price: 60,
    regularPrice: 120,
    billingInterval: 'annual',
    trialDays: 30,
    durationDays: 365,
    description: 'Just $5/month, regularly $120/year — put your Positivity, Health and Wellness plan into action.',
    benefits: CONSUMER_BENEFITS + '\nBest value — save 50%',
  },
  {
    name: 'Fixer Nation Service Providers - Monthly',
    memberType: 'service_provider',
    price: 29,
    regularPrice: 58,
    billingInterval: 'monthly',
    trialDays: 30,
    durationDays: 30,
    description: 'Put an advertising plan for your business into action — take advantage of our introductory offer today.',
    benefits: 'Business listing in the Fixer Nation Vendors network\nAdvertising placement across Fixer Nation channels\nAccess to the Fixer Nation Positivity Health and Wellness Network',
  },
  {
    name: 'Fixer Nation Service Providers - Annual',
    memberType: 'service_provider',
    price: 299,
    regularPrice: 598,
    billingInterval: 'annual',
    trialDays: 30,
    durationDays: 365,
    description: 'Put an advertising plan for your business into action — take advantage of our introductory offer today.',
    benefits: 'Everything in Monthly, plus:\nBest value — save 2 months\nBusiness listing in the Fixer Nation Vendors network\nAdvertising placement across Fixer Nation channels',
  },
  {
    name: 'Registration 2D Education Program',
    memberType: 'service_provider',
    price: 149,
    regularPrice: null,
    billingInterval: 'one_time',
    trialDays: 0,
    durationDays: 365,
    description: 'Complete your registration for the 2D Education Program. For all school-purchased tier plans this price is comped at checkout — be sure to use your school email address. Valid for 12 months.',
    benefits: 'Valid for 12 months\nFor all school-purchased tier plans, price is comped at checkout with a school email address',
  },
  {
    name: 'Fixer Nation Brand Ambassador',
    memberType: 'brand_ambassador',
    price: 499,
    regularPrice: null,
    billingInterval: 'annual',
    trialDays: 365,
    durationDays: 365,
    description: "You'll represent a community of trusted professionals, share our mission of positivity, health, and wellness, and help connect people with resources that make a real difference.",
    benefits: 'Free access to the Fixer Nation Website and Mobile App\nParticipate in the Fixer Nation Residual Compensation Plan\nReceive the Fixer Nation Annual Service Provider Benefits\nBe assigned territory to build their Fixer Nation Network\nHave the potential to earn an Annual Performance Bonus',
  },
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
  for (let i = 0; i < PLANS.length; i++) {
    const p = PLANS[i];
    const [existing] = await connection.query('SELECT id FROM membership_plans WHERE name = ?', [p.name]);
    if (existing.length) {
      console.log(`Skipped (already exists): ${p.name}`);
      skipped++;
      continue;
    }
    await connection.query(
      `INSERT INTO membership_plans
        (name, member_type, price_cents, regular_price_cents, billing_interval, trial_days, duration_days, description, benefits, sort_order, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        p.name, p.memberType, Math.round(p.price * 100),
        p.regularPrice === null ? null : Math.round(p.regularPrice * 100),
        p.billingInterval, p.trialDays, p.durationDays || null, p.description, p.benefits, i,
      ]
    );
    console.log(`Created: ${p.name}`);
    created++;
  }

  console.log(`\nDone. Created ${created}, skipped ${skipped}.`);
  await connection.end();
}

main().catch(err => {
  console.error('Seeding membership plans failed:', err.message);
  process.exit(1);
});
