/* Fixer Nation Admin — shared demo backend (browser localStorage only) */

const FN_KEYS = {
  books: 'fn_books',
  contacts: 'fn_newsletter_contacts',
  curricula: 'fn_curricula',
  downloads: 'fn_curriculum_downloads',
  campaigns: 'fn_campaigns',
  posts: 'fn_blog_posts',
  tags: 'fn_blog_tags',
};

const FN_AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];

// Included-resources checklist for curricula — maps 1:1 to the resource buttons
// shown on the public National Education Portal page for a lesson.
const FN_CURRICULUM_RESOURCES = ['Classroom Poster', 'Student Handout', 'Teacher Copy', 'Quiz + Answer Key'];

// Blog categories shown as filter chips on the public FN Blogs page.
// "Morning Boost" added per request — a short daily-mindset-habit category.
const FN_BLOG_CATEGORIES = ['Morning Boost', 'Weekend Energy', 'Books Blog', 'Mindset'];

function fnUid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function fnSeedIfEmpty() {
  if (!localStorage.getItem(FN_KEYS.books)) {
    const seedBooks = [
      {
        id: fnUid(),
        title: 'Kill the Bully',
        author: 'Anthony J. Placito',
        coverImage: 'cover-kill-the-bully.png',
        shortDescription: 'Stand up to the negativity around you and silence the outer critics holding you back.',
        longDescription: "Alex Parker has had enough. Every day, he faces relentless bullying from Brandon Pierce—at the bus stop, in the hallways, even in front of teachers who turn a blind eye. But when his grandpa offers to teach him how to handle a gun, Alex thinks he's found the perfect solution. Kill the Bully is not just a story about gun control; it's about the battles we fight within ourselves and the choices we make when facing adversity.",
        price: 18.99,
        compareAtPrice: '',
        sku: 'FN-KTB-001',
        category: 'Short Story Series',
        tags: ['Also on Amazon Kindle'],
        stockStatus: 'In Stock',
        amazonUrl: 'https://www.amazon.com',
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 40).toISOString(),
      },
      {
        id: fnUid(),
        title: "Your Past Doesn't Define You",
        author: 'Anthony J. Placito',
        coverImage: 'cover-your-past.png',
        shortDescription: 'Break free from self-doubt and redefine your future with clarity and purpose.',
        longDescription: "The Emily Story — Based on a True Story. Emily and Sam were inseparable until Sam's world shattered. When Emily discovers the horrifying truth, she refuses to stand by, risking everything to help her friend escape her nightmare. A powerful, unflinching story about survival and the strength to reclaim one's life.",
        price: 18.99,
        compareAtPrice: '',
        sku: 'FN-YPD-002',
        category: 'Short Story Series',
        tags: ['Available on Kindle'],
        stockStatus: 'In Stock',
        amazonUrl: 'https://www.amazon.com',
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 25).toISOString(),
      },
      {
        id: fnUid(),
        title: 'Think with 5 Brains, Then Make Up Your Mind',
        author: 'Anthony J. Placito',
        coverImage: 'cover-5-brains.png',
        shortDescription: 'A sharper, more strategic mindset for navigating decisions with confidence.',
        longDescription: 'What if you could unlock a smarter, sharper, and more confident version of yourself? This book introduces a powerful approach to decision-making, challenging you to go beyond instinct and impulse, and equips you with the tools to navigate challenges like "The Fixer."',
        price: 18.99,
        compareAtPrice: '',
        sku: 'FN-T5B-003',
        category: 'Short Story Series',
        tags: ['New Arrival'],
        stockStatus: 'Coming Soon',
        amazonUrl: '',
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 6).toISOString(),
      },
      {
        id: fnUid(),
        title: 'How to Lie and Get Away With It Every Time',
        author: 'Anthony J. Placito',
        coverImage: 'cover-how-to-lie.png',
        shortDescription: 'Strategic thinking and psychological insight, wrapped in compelling storytelling.',
        longDescription: 'From childhood fibs to workplace misdirection, this book opens your eyes to the human tendency to bend truth — emphasizing awareness, ethics, and emotional intelligence so you can protect yourself from manipulation while cultivating trust and understanding.',
        price: 18.99,
        compareAtPrice: '',
        sku: 'FN-HTL-004',
        category: 'Short Story Series',
        tags: ['New Arrival'],
        stockStatus: 'Coming Soon',
        amazonUrl: '',
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 3).toISOString(),
      },
    ];
    localStorage.setItem(FN_KEYS.books, JSON.stringify(seedBooks));
  }

  if (!localStorage.getItem(FN_KEYS.contacts)) {
    const seedContacts = [
      { id: fnUid(), name: 'Jordan Reyes', email: 'jordan.reyes@example.com', address: { street: '214 Maple Ave', city: 'Springfield', state: 'IL', zip: '62701' }, signupDate: new Date(Date.now() - 86400000 * 12).toISOString(), source: 'Homepage', status: 'Subscribed' },
      { id: fnUid(), name: 'Priya Natarajan', email: 'priya.n@example.com', address: { street: '', city: 'Austin', state: 'TX', zip: '' }, signupDate: new Date(Date.now() - 86400000 * 5).toISOString(), source: 'Homepage', status: 'Subscribed' },
      { id: fnUid(), name: 'Sam Whitfield', email: 'sam.whitfield@example.com', address: { street: '', city: '', state: '', zip: '' }, signupDate: new Date(Date.now() - 86400000 * 1).toISOString(), source: 'Homepage', status: 'Subscribed' },
    ];
    localStorage.setItem(FN_KEYS.contacts, JSON.stringify(seedContacts));
  }

  if (!localStorage.getItem(FN_KEYS.campaigns)) {
    localStorage.setItem(FN_KEYS.campaigns, JSON.stringify([]));
  }

  if (!localStorage.getItem(FN_KEYS.curricula)) {
    const seedCurricula = [
      {
        id: fnUid(),
        title: 'Responsibility & Ownership: Take Responsibility for Your Growth',
        series: 'SEL Morning Boost',
        audiences: ['Elementary School', 'Middle School'],
        shortDescription: 'A 5-lesson unit helping students understand that personal growth happens when they choose effort, practice, and steady learning.',
        overview: "Students will understand that support from teachers, family, and friends matters, but no one can grow for them. This unit builds self-awareness and accountability through daily reflection, guided discussion, and a culminating project.",
        objectives: [
          'Identify the difference between effort and outcome',
          'Practice daily reflection on personal choices',
          'Build a personal accountability plan',
        ],
        estimatedDuration: '5 lessons · 1 week (30 min/day)',
        materials: ['Classroom poster (included)', 'Student reflection journal', 'Whiteboard or chart paper'],
        resources: ['Classroom Poster', 'Student Handout', 'Teacher Copy', 'Quiz + Answer Key'],
        lessonDocument: '',
        lessonDocumentName: '',
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
        createdAt: new Date(Date.now() - 86400000 * 14).toISOString(),
      },
      {
        id: fnUid(),
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
        lessonDocument: '',
        lessonDocumentName: '',
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
        createdAt: new Date(Date.now() - 86400000 * 2).toISOString(),
      },
    ];
    localStorage.setItem(FN_KEYS.curricula, JSON.stringify(seedCurricula));
  }

  if (!localStorage.getItem(FN_KEYS.downloads)) {
    localStorage.setItem(FN_KEYS.downloads, JSON.stringify([]));
  }

  if (!localStorage.getItem(FN_KEYS.posts)) {
    const seedPosts = [
      {
        id: fnUid(),
        title: 'Turning Your Issue Into an Answer, One Morning Boost at a Time',
        slug: 'turning-your-issue-into-an-answer-one-morning-boost-at-a-time',
        author: 'Anthony J. Placito',
        category: 'Morning Boost',
        featuredImage: 'https://images.unsplash.com/photo-1500462918059-b1a0cb512f1d?w=900&q=80',
        excerpt: "How a five-minute daily habit can reset your mindset and carry you through the week's hardest moments — straight from the Fixer Nation philosophy.",
        body: "Every issue has an answer — but only if you show up for it. The Morning Boost is a five-minute ritual: one minute of stillness, one minute naming the issue in front of you, one minute reframing it as a question instead of a wall, one minute writing down the smallest next step, and one minute of gratitude for something already working in your favor.\n\nIt sounds small. It is small. That's the point — a habit has to survive your worst mornings to actually count as a habit. Do it on the days you don't want to, and it'll be there for you on the days you need it most.\n\nStart tomorrow. Five minutes. One issue. One answer.",
        tags: ['Morning Boost', 'Habits', 'Mindset'],
        publishDate: new Date(Date.now() - 86400000 * 9).toISOString().slice(0, 10),
        featured: true,
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 9).toISOString(),
      },
      {
        id: fnUid(),
        title: 'A 5-Minute Morning Boost Ritual to Start the Day as the Fixer',
        slug: 'a-5-minute-morning-boost-ritual-to-start-the-day-as-the-fixer',
        author: 'Anthony J. Placito',
        category: 'Morning Boost',
        featuredImage: 'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=600&q=80',
        excerpt: "Before the phone, before the noise — a short ritual that sets the tone for the whole day.",
        body: "The Fixer doesn't wait for a good mood to show up before doing good work. The Fixer builds the mood on purpose, first thing, before the day gets a vote.\n\nTry this: phone stays face-down for the first ten minutes you're awake. Instead, ask yourself one question — \"What's one issue I can turn into an answer today?\" Write down whatever comes up, even if it's small. Then go do the first thing on your actual to-do list before checking a single notification.\n\nSmall wins compound. A Morning Boost isn't about fixing everything — it's about proving to yourself, daily, that you're someone who fixes things.",
        tags: ['Morning Boost', 'Routine'],
        publishDate: new Date(Date.now() - 86400000 * 4).toISOString().slice(0, 10),
        featured: false,
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 4).toISOString(),
      },
      {
        id: fnUid(),
        title: 'Silencing the Inner Critic',
        slug: 'silencing-the-inner-critic',
        author: 'Anthony J. Placito',
        category: 'Mindset',
        featuredImage: 'https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=600&q=80',
        excerpt: 'Practical steps for redirecting self-doubt into forward motion.',
        body: "The inner critic rarely says anything untrue — it just says it at the worst possible time, in the worst possible tone. The goal isn't to silence it forever; it's to stop letting it drive.\n\nWhen it shows up, try naming it out loud: \"That's the critic talking.\" That tiny bit of distance is often enough to keep moving instead of freezing. Then ask what a coach — not a critic — would say about the same situation. Usually it's shorter, kinder, and more useful.",
        tags: ['Mindset', 'Self-Talk'],
        publishDate: new Date(Date.now() - 86400000 * 18).toISOString().slice(0, 10),
        featured: false,
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 18).toISOString(),
      },
      {
        id: fnUid(),
        title: 'Behind the Pages of Kill the Bully',
        slug: 'behind-the-pages-of-kill-the-bully',
        author: 'Anthony J. Placito',
        category: 'Books Blog',
        featuredImage: 'https://images.unsplash.com/photo-1499750310107-5fef28a66643?w=600&q=80',
        excerpt: 'What inspired the book, and how readers are using it to stand their ground.',
        body: "Kill the Bully started as a true story before it became a book. The goal was never to glamorize a solution — it was to be honest about how real the pressure feels when you're the one being targeted, and how many different directions that pressure can push a person.\n\nReaders have told us they've used it to open conversations at home that were otherwise hard to start. That's the part that matters most — not the plot twist, but the door it opens.",
        tags: ['Books Blog', 'Behind the Scenes'],
        publishDate: new Date(Date.now() - 86400000 * 27).toISOString().slice(0, 10),
        featured: false,
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 27).toISOString(),
      },
      {
        id: fnUid(),
        title: 'Resetting Before Monday',
        slug: 'resetting-before-monday',
        author: 'Anthony J. Placito',
        category: 'Weekend Energy',
        featuredImage: 'https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=600&q=80',
        excerpt: 'A short ritual to close out the week and walk into the next one with clarity.',
        body: "Sunday doesn't have to be dread — it can be the reset button. Spend ten minutes reviewing what actually went well this week (not just what went wrong), then pick one single priority for Monday morning. One. Not five.\n\nClose the loop on anything you can close today, and give yourself permission to leave the rest for the version of you that shows up tomorrow, already rested and already clear on what matters first.",
        tags: ['Weekend Energy', 'Routine'],
        publishDate: new Date(Date.now() - 86400000 * 33).toISOString().slice(0, 10),
        featured: false,
        published: true,
        createdAt: new Date(Date.now() - 86400000 * 33).toISOString(),
      },
    ];
    localStorage.setItem(FN_KEYS.posts, JSON.stringify(seedPosts));
  }

  if (!localStorage.getItem(FN_KEYS.tags)) {
    // Seeded from the tags already used on the sample posts above, plus the categories themselves.
    const seedTags = ['Morning Boost', 'Habits', 'Mindset', 'Routine', 'Self-Talk', 'Books Blog', 'Behind the Scenes', 'Weekend Energy'];
    localStorage.setItem(FN_KEYS.tags, JSON.stringify(seedTags));
  }
}

// Real server-side auth (session cookie), replacing the old sessionStorage flag.
// Redirects to the login page if the session check fails or errors out.
function fnRequireAuth() {
  fnSeedIfEmpty();
  fetch('/api/auth/me', { credentials: 'include' })
    .then(r => r.json())
    .then(data => {
      if (!data.loggedIn) window.location.href = 'admin-login.html';
    })
    .catch(() => { window.location.href = 'admin-login.html'; });
}

// Returns a Promise resolving to { ok, username? , error? }.
function fnLogin(username, password) {
  return fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ username, password }),
  })
    .then(async r => {
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return { ok: false, error: data.error || 'Login failed' };
      return { ok: true, username: data.username };
    })
    .catch(() => ({ ok: false, error: 'Could not reach the server' }));
}

function fnLogout() {
  // A bodyless POST gets rejected upstream of the app on this host, so always
  // send a Content-Type + JSON body (even if empty) on POST/PUT/DELETE calls.
  fetch('/api/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  })
    .finally(() => { window.location.href = 'admin-login.html'; });
}

// If a fetch to an authenticated API endpoint comes back 401, the session has
// expired or was never valid — bounce to login instead of showing broken/empty data.
function fnHandleUnauthorized(response) {
  if (response.status === 401) {
    window.location.href = 'admin-login.html';
    return true;
  }
  return false;
}

function fnGetBooks() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.books) || '[]');
}
function fnSaveBooks(books) {
  localStorage.setItem(FN_KEYS.books, JSON.stringify(books));
}

function fnGetContacts() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.contacts) || '[]');
}
function fnSaveContacts(contacts) {
  localStorage.setItem(FN_KEYS.contacts, JSON.stringify(contacts));
}

function fnAddNewsletterContact(name, email, source, address) {
  const contacts = fnGetContacts();
  const exists = contacts.some(c => c.email.toLowerCase() === email.toLowerCase());
  if (exists) return { ok: false, reason: 'duplicate' };
  contacts.unshift({
    id: fnUid(),
    name: name || '',
    email: email,
    address: address || { street: '', city: '', state: '', zip: '' },
    signupDate: new Date().toISOString(),
    source: source || 'Homepage',
    status: 'Subscribed',
  });
  fnSaveContacts(contacts);
  return { ok: true };
}

function fnFormatAddress(address, full) {
  if (!address) return '—';
  const { street, city, state, zip } = address;
  if (full) {
    const parts = [street, [city, state].filter(Boolean).join(', '), zip].filter(Boolean);
    return parts.length ? parts.join(' · ') : '—';
  }
  const cityState = [city, state].filter(Boolean).join(', ');
  return cityState || '—';
}

/* ---- CSV parsing (handles quoted fields with embedded commas) ---- */
function fnParseCsv(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], next = text[i + 1];
    if (inQuotes) {
      if (c === '"' && next === '"') { field += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { field += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && next === '\n') i++;
        row.push(field); field = '';
        if (row.some(v => v !== '')) rows.push(row);
        row = [];
      } else { field += c; }
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  if (rows.length === 0) return [];

  const header = rows[0].map(h => h.trim().toLowerCase());
  const findCol = (...names) => header.findIndex(h => names.includes(h));
  const idx = {
    name: findCol('name', 'full name', 'contact name'),
    email: findCol('email', 'email address'),
    street: findCol('address', 'street', 'street address'),
    city: findCol('city'),
    state: findCol('state', 'province'),
    zip: findCol('zip', 'zip code', 'postal code', 'postcode'),
    source: findCol('source'),
  };

  return rows.slice(1).map(r => ({
    name: idx.name >= 0 ? (r[idx.name] || '').trim() : '',
    email: idx.email >= 0 ? (r[idx.email] || '').trim() : '',
    street: idx.street >= 0 ? (r[idx.street] || '').trim() : '',
    city: idx.city >= 0 ? (r[idx.city] || '').trim() : '',
    state: idx.state >= 0 ? (r[idx.state] || '').trim() : '',
    zip: idx.zip >= 0 ? (r[idx.zip] || '').trim() : '',
    source: idx.source >= 0 ? (r[idx.source] || '').trim() : '',
  }));
}

// Bulk-imports parsed CSV rows, skipping rows without a valid-looking email
// and rows whose email already exists. Returns a summary.
function fnImportContacts(parsedRows, defaultSource) {
  const contacts = fnGetContacts();
  const existingEmails = new Set(contacts.map(c => c.email.toLowerCase()));
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  let imported = 0, skippedInvalid = 0, skippedDuplicate = 0;
  parsedRows.forEach(row => {
    const email = (row.email || '').trim();
    if (!email || !emailPattern.test(email)) { skippedInvalid++; return; }
    if (existingEmails.has(email.toLowerCase())) { skippedDuplicate++; return; }
    contacts.unshift({
      id: fnUid(),
      name: row.name || '',
      email,
      address: { street: row.street || '', city: row.city || '', state: row.state || '', zip: row.zip || '' },
      signupDate: new Date().toISOString(),
      source: row.source || defaultSource || 'Bulk Import',
      status: 'Subscribed',
    });
    existingEmails.add(email.toLowerCase());
    imported++;
  });
  fnSaveContacts(contacts);
  return { imported, skippedInvalid, skippedDuplicate };
}

/* ---- Mass marketing email campaigns (simulated — no real email is sent) ---- */
function fnGetCampaigns() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.campaigns) || '[]');
}
function fnSaveCampaigns(campaigns) {
  localStorage.setItem(FN_KEYS.campaigns, JSON.stringify(campaigns));
}

// audienceFilter: { status: 'Subscribed'|'All', source: 'All'|<source string> }
function fnGetAudience(audienceFilter) {
  const contacts = fnGetContacts();
  return contacts.filter(c => {
    if (audienceFilter.status && audienceFilter.status !== 'All' && c.status !== audienceFilter.status) return false;
    if (audienceFilter.source && audienceFilter.source !== 'All' && c.source !== audienceFilter.source) return false;
    return true;
  });
}

function fnGetContactSources() {
  const contacts = fnGetContacts();
  return Array.from(new Set(contacts.map(c => c.source).filter(Boolean)));
}

function fnGetCurricula() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.curricula) || '[]');
}
function fnSaveCurricula(curricula) {
  localStorage.setItem(FN_KEYS.curricula, JSON.stringify(curricula));
}

function fnGetDownloadLog() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.downloads) || '[]');
}
function fnSaveDownloadLog(log) {
  localStorage.setItem(FN_KEYS.downloads, JSON.stringify(log));
}

// Returns records of { curriculumId, teacherEmail, count } for one curriculum
function fnGetDownloadsForCurriculum(curriculumId) {
  return fnGetDownloadLog().filter(d => d.curriculumId === curriculumId);
}

// Attempts a simulated teacher download. Enforces the per-teacher download limit
// configured on the curriculum. Returns { ok, count, limit, reason }.
function fnSimulateDownload(curriculumId, teacherEmail) {
  const curricula = fnGetCurricula();
  const curriculum = curricula.find(c => c.id === curriculumId);
  if (!curriculum) return { ok: false, reason: 'not_found' };

  const log = fnGetDownloadLog();
  const email = teacherEmail.trim().toLowerCase();
  let record = log.find(d => d.curriculumId === curriculumId && d.teacherEmail === email);

  const limit = Number(curriculum.downloadLimit) || 0;
  const currentCount = record ? record.count : 0;

  if (limit > 0 && currentCount >= limit) {
    return { ok: false, reason: 'limit_reached', count: currentCount, limit };
  }

  if (record) {
    record.count += 1;
    record.lastDownload = new Date().toISOString();
  } else {
    record = { id: fnUid(), curriculumId, teacherEmail: email, count: 1, lastDownload: new Date().toISOString() };
    log.push(record);
  }
  fnSaveDownloadLog(log);
  return { ok: true, count: record.count, limit };
}

function fnResetDownloads(curriculumId, teacherEmail) {
  let log = fnGetDownloadLog();
  if (teacherEmail) {
    const email = teacherEmail.trim().toLowerCase();
    log = log.filter(d => !(d.curriculumId === curriculumId && d.teacherEmail === email));
  } else {
    log = log.filter(d => d.curriculumId !== curriculumId);
  }
  fnSaveDownloadLog(log);
}

/* ---- Blog posts ---- */
function fnGetBlogPosts() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.posts) || '[]');
}
function fnSaveBlogPosts(posts) {
  localStorage.setItem(FN_KEYS.posts, JSON.stringify(posts));
}
// Published posts only, newest first — what the public site should render.
function fnGetPublishedBlogPosts() {
  return fnGetBlogPosts()
    .filter(p => p.published)
    .sort((a, b) => new Date(b.publishDate) - new Date(a.publishDate));
}
// Master list of blog tags, grown over time as the user creates new ones —
// distinct from FN_BLOG_CATEGORIES, which is a fixed set.
function fnGetBlogTags() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.tags) || '[]');
}
function fnSaveBlogTags(tags) {
  localStorage.setItem(FN_KEYS.tags, JSON.stringify(tags));
}
// Adds a new tag to the master list (case-insensitive dedupe) and returns the
// canonical stored tag string, so it's available in the picker for future posts.
function fnAddBlogTag(tag) {
  const clean = (tag || '').trim();
  if (!clean) return '';
  const tags = fnGetBlogTags();
  const existing = tags.find(t => t.toLowerCase() === clean.toLowerCase());
  if (existing) return existing;
  tags.push(clean);
  fnSaveBlogTags(tags);
  return clean;
}

function fnSlugify(str) {
  return (str || '')
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');
}
// Rough reading-time estimate for display in the admin list (~200 wpm).
function fnReadingTime(body) {
  const words = (body || '').trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return minutes + ' min read';
}

// Turns a pasted YouTube/Vimeo link (or a direct video file path/URL) into
// embeddable HTML for a video blog post. Returns '' for an empty/invalid url.
function fnVideoEmbedHtml(url) {
  if (!url) return '';
  url = url.trim();
  const yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) {
    return `<div class="fn-video-embed"><iframe src="https://www.youtube.com/embed/${yt[1]}" title="Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  const vim = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vim) {
    return `<div class="fn-video-embed"><iframe src="https://player.vimeo.com/video/${vim[1]}" title="Video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div>`;
  }
  // Otherwise assume it's a direct video file (local filename or a hosted .mp4/.webm URL).
  // If the referenced file isn't actually reachable (e.g. it was never placed in this
  // folder), show a clear message instead of a silently broken player.
  return `<div class="fn-video-embed"><video controls src="${url}" onerror="fnHandleVideoError(this, '${url.replace(/'/g, "\\'")}')"></video></div>`;
}

function fnHandleVideoError(videoEl, label) {
  const wrap = videoEl.closest('.fn-video-embed');
  if (!wrap) return;
  wrap.innerHTML = '<div style="display:flex; align-items:center; justify-content:center; height:100%; color:#fff; font-family:sans-serif; font-size:13px; text-align:center; padding:16px; line-height:1.5;">⚠️ Couldn\'t find <strong>' + label + '</strong>.<br>Make sure a file with this exact name is in the project folder.</div>';
}

function fnFormatDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fnFormatCurrency(n) {
  if (n === '' || n === null || n === undefined || isNaN(n)) return '—';
  return '$' + Number(n).toFixed(2);
}

function fnToast(msg) {
  let toast = document.getElementById('fnToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'fnToast';
    toast.className = 'a-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(window._fnToastTimer);
  window._fnToastTimer = setTimeout(() => toast.classList.remove('show'), 2400);
}
