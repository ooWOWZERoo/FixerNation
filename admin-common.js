/* Fixer Nation Admin — shared demo backend (browser localStorage only) */

const FN_KEYS = {
  contacts: 'fn_newsletter_contacts',
  campaigns: 'fn_campaigns',
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

// Uploads a File to the server and returns its public URL, or null on failure
// (after showing a toast). Shared by books, curriculum, and blog admin pages.
async function fnUploadFile(file) {
  const formData = new FormData();
  formData.append('file', file);
  const r = await fetch('/api/uploads', { method: 'POST', credentials: 'include', body: formData });
  if (fnHandleUnauthorized(r)) return null;
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    fnToast(err.error || 'Upload failed');
    return null;
  }
  return (await r.json()).url;
}

// NOTE: newsletter contacts themselves live on the real API now (/api/newsletter/*).
// This localStorage-backed getter is kept only because admin-campaigns.html's
// audience targeting (fnGetAudience/fnGetContactSources below) still reads it —
// remove once campaigns are migrated too.
function fnGetContacts() {
  fnSeedIfEmpty();
  return JSON.parse(localStorage.getItem(FN_KEYS.contacts) || '[]');
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
