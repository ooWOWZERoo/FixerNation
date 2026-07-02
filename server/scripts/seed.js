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

main().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
