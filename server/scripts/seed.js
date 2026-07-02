require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const username = process.env.ADMIN_USERNAME || 'admin';
  const password = process.env.ADMIN_PASSWORD || 'FixerNation2026!';

  const [existing] = await connection.query('SELECT id FROM admin_users WHERE username = ?', [username]);
  if (existing.length) {
    console.log(`Admin user "${username}" already exists, skipping.`);
  } else {
    const passwordHash = await bcrypt.hash(password, 12);
    await connection.query('INSERT INTO admin_users (username, password_hash) VALUES (?, ?)', [username, passwordHash]);
    console.log(`Created admin user "${username}".`);
    if (!process.env.ADMIN_PASSWORD) {
      console.warn('WARNING: using the default demo password. Set ADMIN_USERNAME/ADMIN_PASSWORD env vars before running this against production.');
    }
  }

  await seedBooks(connection);
  await seedCurricula(connection);

  await connection.end();
}

async function seedBooks(connection) {
  const [existing] = await connection.query('SELECT id FROM books LIMIT 1');
  if (existing.length) {
    console.log('Books already exist, skipping book seed.');
    return;
  }

  const books = [
    {
      title: 'Kill the Bully',
      author: 'Anthony J. Placito',
      coverImage: 'cover-kill-the-bully.png',
      shortDescription: 'Stand up to the negativity around you and silence the outer critics holding you back.',
      longDescription: "Alex Parker has had enough. Every day, he faces relentless bullying from Brandon Pierce—at the bus stop, in the hallways, even in front of teachers who turn a blind eye. But when his grandpa offers to teach him how to handle a gun, Alex thinks he's found the perfect solution. Kill the Bully is not just a story about gun control; it's about the battles we fight within ourselves and the choices we make when facing adversity.",
      price: 18.99,
      sku: 'FN-KTB-001',
      category: 'Short Story Series',
      tags: ['Also on Amazon Kindle'],
      stockStatus: 'In Stock',
      amazonUrl: 'https://www.amazon.com',
      published: true,
    },
    {
      title: "Your Past Doesn't Define You",
      author: 'Anthony J. Placito',
      coverImage: 'cover-your-past.png',
      shortDescription: 'Break free from self-doubt and redefine your future with clarity and purpose.',
      longDescription: "The Emily Story — Based on a True Story. Emily and Sam were inseparable until Sam's world shattered. When Emily discovers the horrifying truth, she refuses to stand by, risking everything to help her friend escape her nightmare. A powerful, unflinching story about survival and the strength to reclaim one's life.",
      price: 18.99,
      sku: 'FN-YPD-002',
      category: 'Short Story Series',
      tags: ['Available on Kindle'],
      stockStatus: 'In Stock',
      amazonUrl: 'https://www.amazon.com',
      published: true,
    },
    {
      title: 'Think with 5 Brains, Then Make Up Your Mind',
      author: 'Anthony J. Placito',
      coverImage: 'cover-5-brains.png',
      shortDescription: 'A sharper, more strategic mindset for navigating decisions with confidence.',
      longDescription: 'What if you could unlock a smarter, sharper, and more confident version of yourself? This book introduces a powerful approach to decision-making, challenging you to go beyond instinct and impulse, and equips you with the tools to navigate challenges like "The Fixer."',
      price: 18.99,
      sku: 'FN-T5B-003',
      category: 'Short Story Series',
      tags: ['New Arrival'],
      stockStatus: 'Coming Soon',
      amazonUrl: '',
      published: true,
    },
    {
      title: 'How to Lie and Get Away With It Every Time',
      author: 'Anthony J. Placito',
      coverImage: 'cover-how-to-lie.png',
      shortDescription: 'Strategic thinking and psychological insight, wrapped in compelling storytelling.',
      longDescription: 'From childhood fibs to workplace misdirection, this book opens your eyes to the human tendency to bend truth — emphasizing awareness, ethics, and emotional intelligence so you can protect yourself from manipulation while cultivating trust and understanding.',
      price: 18.99,
      sku: 'FN-HTL-004',
      category: 'Short Story Series',
      tags: ['New Arrival'],
      stockStatus: 'Coming Soon',
      amazonUrl: '',
      published: true,
    },
  ];

  for (const b of books) {
    const [result] = await connection.query(
      `INSERT INTO books (title, author, cover_image, short_description, long_description, price, sku, category, stock_status, amazon_url, published)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [b.title, b.author, b.coverImage, b.shortDescription, b.longDescription, b.price, b.sku, b.category, b.stockStatus, b.amazonUrl, b.published ? 1 : 0]
    );
    for (const tag of b.tags) {
      await connection.query('INSERT INTO book_tags (book_id, tag) VALUES (?, ?)', [result.insertId, tag]);
    }
  }
  console.log(`Seeded ${books.length} books.`);
}

async function seedCurricula(connection) {
  const [existing] = await connection.query('SELECT id FROM curricula LIMIT 1');
  if (existing.length) {
    console.log('Curricula already exist, skipping curriculum seed.');
    return;
  }

  const curricula = [
    {
      title: 'Responsibility & Ownership: Take Responsibility for Your Growth',
      series: 'SEL Morning Boost',
      audiences: ['Elementary School', 'Middle School'],
      shortDescription: 'A 5-lesson unit helping students understand that personal growth happens when they choose effort, practice, and steady learning.',
      overview: 'Students will understand that support from teachers, family, and friends matters, but no one can grow for them. This unit builds self-awareness and accountability through daily reflection, guided discussion, and a culminating project.',
      objectives: [
        'Identify the difference between effort and outcome',
        'Practice daily reflection on personal choices',
        'Build a personal accountability plan',
      ],
      estimatedDuration: '5 lessons · 1 week (30 min/day)',
      materials: ['Classroom poster (included)', 'Student reflection journal', 'Whiteboard or chart paper'],
      resources: ['Classroom Poster', 'Student Handout', 'Teacher Copy', 'Quiz + Answer Key'],
      videos: [],
      quiz: [
        {
          question: 'What does it mean to "own" your growth?',
          options: ['Blaming others when things go wrong', 'Choosing effort and steady learning, even when uncomfortable', 'Waiting for someone else to fix the problem', 'Avoiding challenges altogether'],
          correctIndex: 1,
        },
        {
          question: 'Which of these is an example of a growth choice?',
          options: ['Giving up after one try', 'Asking for help and trying again', 'Ignoring feedback', 'Comparing yourself only to others'],
          correctIndex: 1,
        },
      ],
      downloadLimit: 3,
      published: true,
    },
    {
      title: 'Think with 5 Brains: Decision-Making Workshop',
      series: 'Positivity, Health & Wellness',
      audiences: ['High School', 'Higher Education'],
      shortDescription: 'A strategic-thinking curriculum built on the "Think with 5 Brains" framework for stronger, more confident decisions.',
      overview: 'This curriculum challenges students to slow down and examine decisions from multiple angles before acting. Includes discussion-based lessons, a group activity, and a short written reflection.',
      objectives: [
        'Apply a 5-step decision framework to real scenarios',
        'Practice identifying assumptions and biases',
        'Communicate a decision rationale clearly',
      ],
      estimatedDuration: '3 lessons · 2 weeks',
      materials: ['Handout packet', 'Scenario cards'],
      resources: ['Student Handout', 'Teacher Copy', 'Quiz + Answer Key'],
      videos: [],
      quiz: [
        {
          question: 'Why use multiple "brains" before deciding?',
          options: ['To slow down and avoid all decisions', 'To consider a decision from more than one angle', 'To always follow the majority', 'To skip the decision entirely'],
          correctIndex: 1,
        },
      ],
      downloadLimit: 5,
      published: false,
    },
  ];

  for (const c of curricula) {
    const [result] = await connection.query(
      `INSERT INTO curricula (title, series, short_description, overview, estimated_duration, download_limit, published)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [c.title, c.series, c.shortDescription, c.overview, c.estimatedDuration, c.downloadLimit, c.published ? 1 : 0]
    );
    const id = result.insertId;
    for (const a of c.audiences) await connection.query('INSERT INTO curriculum_audiences (curriculum_id, audience) VALUES (?, ?)', [id, a]);
    for (let i = 0; i < c.objectives.length; i++) await connection.query('INSERT INTO curriculum_objectives (curriculum_id, objective, sort_order) VALUES (?, ?, ?)', [id, c.objectives[i], i]);
    for (let i = 0; i < c.materials.length; i++) await connection.query('INSERT INTO curriculum_materials (curriculum_id, material, sort_order) VALUES (?, ?, ?)', [id, c.materials[i], i]);
    for (const r of c.resources) await connection.query('INSERT INTO curriculum_resources (curriculum_id, resource) VALUES (?, ?)', [id, r]);
    for (const q of c.quiz) {
      const [qResult] = await connection.query('INSERT INTO curriculum_quiz_questions (curriculum_id, question, correct_index) VALUES (?, ?, ?)', [id, q.question, q.correctIndex]);
      for (let oi = 0; oi < q.options.length; oi++) {
        await connection.query('INSERT INTO curriculum_quiz_options (question_id, option_text, sort_order) VALUES (?, ?, ?)', [qResult.insertId, q.options[oi], oi]);
      }
    }
  }
  console.log(`Seeded ${curricula.length} curricula.`);
}

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
