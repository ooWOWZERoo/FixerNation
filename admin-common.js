/* Fixer Nation Admin — shared helpers for the real API-backed admin backend and public site */

const FN_AUDIENCES = ['Elementary School', 'Middle School', 'High School', 'Higher Education'];

// Included-resources checklist for curricula — maps 1:1 to the resource buttons
// shown on the public National Education Portal page for a lesson.
const FN_CURRICULUM_RESOURCES = ['Classroom Poster', 'Student Handout', 'Teacher Copy', 'Quiz + Answer Key'];

// Blog categories shown as filter chips on the public FN Blogs page. A post
// can now belong to several at once (see blog_post_categories) — the 9
// "2D Education"/Health/Positivity/Wellness entries were added to match the
// Morning Boost content's real Wix category set, which always applies more
// than one category per post.
const FN_BLOG_CATEGORIES = [
  'Morning Boost', 'Weekend Energy', 'Books Blog', 'Mindset',
  'Health', 'Positivity', 'Wellness',
  '2D Education Higher Education', '2D Education High School', '2D Education Middle School', '2D Elementary School',
  '2D Business and Industry', '2D Government',
];

// Wildcard-aware string match for admin search fields.
// term must already be lowercased. * matches any sequence, ? matches any one char.
// Falls back to substring match when no wildcards are present.
function fnWildcardTest(term, value) {
  if (!term) return true;
  const v = (value || '').toLowerCase();
  if (term.includes('*') || term.includes('?')) {
    const pattern = term.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
    return new RegExp('^' + pattern + '$').test(v);
  }
  return v.includes(term);
}

// Real server-side auth (session cookie). Redirects to the login page if the
// session check fails or errors out.
function fnRequireAuth() {
  fetch('/api/auth/me?nc=' + Date.now(), { credentials: 'include' })
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
  try {
    const formData = new FormData();
    formData.append('file', file);
    const r = await fetch('/api/uploads', { method: 'POST', credentials: 'include', body: formData });
    if (fnHandleUnauthorized(r)) return null;
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      fnToast(err.error || 'Upload failed (status ' + r.status + ')');
      return null;
    }
    const data = await r.json();
    if (!data.url) { fnToast('Upload error: server returned no URL'); return null; }
    return data.url;
  } catch (e) {
    fnToast('Upload failed: ' + (e.message || 'network error'));
    return null;
  }
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
// Always includes a direct-link fallback so the video is accessible even if
// the iframe is blocked by a server-side Content-Security-Policy.
function fnVideoEmbedHtml(url) {
  if (!url) return '';
  url = url.trim();
  const yt = url.match(/(?:youtube(?:-nocookie)?\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) {
    const vid = yt[1];
    const watchUrl = `https://www.youtube.com/watch?v=${vid}`;
    return `<div class="fn-video-embed"><iframe src="https://www.youtube.com/embed/${vid}" title="Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div><div style="text-align:center;margin-top:6px;font-size:13px;opacity:.75;"><a href="${watchUrl}" target="_blank" rel="noopener" style="color:inherit;">Can't see the video? <strong>Watch on YouTube →</strong></a></div>`;
  }
  const vim = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vim) {
    const watchUrl = `https://vimeo.com/${vim[1]}`;
    return `<div class="fn-video-embed"><iframe src="https://player.vimeo.com/video/${vim[1]}" title="Video" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe></div><div style="text-align:center;margin-top:6px;font-size:13px;opacity:.75;"><a href="${watchUrl}" target="_blank" rel="noopener" style="color:inherit;">Can't see the video? <strong>Watch on Vimeo →</strong></a></div>`;
  }
  // Otherwise assume it's a direct video file (local filename or a hosted .mp4/.webm URL).
  // If the referenced file isn't actually reachable (e.g. it was never placed in this
  // folder), show a clear message instead of a silently broken player.
  return `<div class="fn-video-embed"><video controls controlsList="nodownload" oncontextmenu="return false;" src="${url}" onerror="fnHandleVideoError(this, '${url.replace(/'/g, "\\'")}')"></video></div>`;
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

// Light/dark theme for the admin backend. The actual attribute is set as
// early as possible by a tiny inline script in each page's <head> (before
// admin-common.css loads) to avoid a flash of the wrong theme — this just
// handles the toggle click and keeps any toggle button's icon in sync.
function fnToggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('fnTheme', next);
  fnSyncThemeToggleUI();
}

function fnSyncThemeToggleUI() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  document.querySelectorAll('.a-theme-toggle .ic-sun').forEach(el => el.classList.toggle('on', !isDark));
  document.querySelectorAll('.a-theme-toggle .ic-moon').forEach(el => el.classList.toggle('on', isDark));
}

document.addEventListener('DOMContentLoaded', fnSyncThemeToggleUI);

// Populates a hand-authored book detail page (book-*.html) with live data
// from the database, matched by exact title. Shared across all book detail
// pages since they share the same markup structure (.eyebrow, h1, .product-price,
// .stock-badge, .product-desc, .amazon-link, .product-photo img).
function fnPopulateBookDetail(title) {
  fetch('/api/books')
    .then(r => r.json())
    .then(data => {
      const book = (data.books || []).find(b => b.title === title);
      if (!book) return;

      // Exposed so each book-detail page's own inline script can wire up a
      // real Add to Cart button without re-fetching the book itself.
      window.fnCurrentBook = book;
      if (typeof fnTrackEvent === 'function') fnTrackEvent('book_view', book.title);

      const eyebrow = document.querySelector('.product-info .eyebrow');
      if (eyebrow) eyebrow.textContent = book.category || 'Short Story Book Series';

      const h1 = document.querySelector('.product-info h1');
      if (h1) h1.textContent = book.title;

      const priceEl = document.querySelector('.product-price');
      if (priceEl) priceEl.textContent = fnFormatCurrency(book.price);

      const stockBadge = document.querySelector('.stock-badge');
      if (stockBadge) {
        const colors = { 'In Stock': '#164F4A', 'Coming Soon': '#EBA657', 'Out of Stock': '#B4762A' };
        const color = colors[book.stockStatus] || colors['In Stock'];
        stockBadge.innerHTML = `<span class="stock-dot" style="background:${color};"></span> ${book.stockStatus || 'In Stock'}`;
      }

      const desc = document.querySelector('.product-desc');
      if (desc && book.longDescription) {
        const paragraphs = book.longDescription.split(/\n+/).filter(Boolean);
        desc.innerHTML = paragraphs.map((p, i) => i === 0 ? `<p><em>${p}</em></p>` : `<p>${p}</p>`).join('');
      }

      const amazonFormats = document.getElementById('amazonFormats');
      if (amazonFormats) {
        const formats = [
          { label: 'Kindle', price: book.kindlePrice, url: book.kindleUrl },
          { label: 'Hardcover', price: book.hardcoverPrice, url: book.hardcoverUrl },
          { label: 'Paperback', price: book.paperbackPrice, url: book.paperbackUrl },
        ].filter(f => f.price !== '' && f.price !== null && f.price !== undefined);

        if (formats.length) {
          amazonFormats.innerHTML = '<div class="amazon-formats-label">Also available on Amazon:</div>' +
            '<div class="amazon-formats-row">' +
            formats.map(f => f.url
              ? `<a class="amazon-format-btn" href="${f.url}" target="_blank" rel="noopener">${f.label} — ${fnFormatCurrency(f.price)}</a>`
              : `<span class="amazon-format-btn">${f.label} — ${fnFormatCurrency(f.price)}</span>`
            ).join('') +
            '</div>';
        } else {
          amazonFormats.innerHTML = '';
        }
      }

      const photo = document.querySelector('.product-photo img');
      if (photo && book.coverImage) {
        photo.src = book.coverImage;
        photo.alt = book.title + ' book cover';
      }
    })
    .catch(() => {});
}

// --- Anonymous visitor-path tracking (public v1 pages only — never called
// from admin pages, so staff activity is never recorded as visitor data) ---

function fnAnalyticsSessionId() {
  const KEY = 'fnAnalyticsSession';
  let id = sessionStorage.getItem(KEY);
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    sessionStorage.setItem(KEY, id);
  }
  return id;
}

// Uses sendBeacon so the request reliably fires even during page unload
// (e.g. tracking that someone left a page), without blocking navigation.
function fnTrackEvent(eventType, label) {
  if (localStorage.getItem('fnAnalyticsOptOut') === '1') return;
  const payload = JSON.stringify({
    sessionId: fnAnalyticsSessionId(),
    eventType,
    page: window.location.pathname,
    label: label || '',
    referrer: document.referrer,
  });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics/track', new Blob([payload], { type: 'application/json' }));
  } else {
    fetch('/api/analytics/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {});
  }
}

function fnTrackPageview() {
  fnTrackEvent('pageview', document.title);
}
