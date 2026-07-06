const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const SESSION_ID_PATTERN = /^[a-zA-Z0-9-]{8,64}$/;
const EVENT_TYPE_PATTERN = /^[a-z_]{1,32}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

// Which tracked events count as "explored content" vs "showed buying/contact
// intent" for the funnel view. There's no "purchased" stage here on purpose —
// analytics sessions are deliberately anonymous with no link to a purchase record.
const ENGAGED_EVENTS = ['book_view', 'resource_open'];
const INTENT_EVENTS = ['add_to_cart', 'quote_request', 'ask_the_fixer', 'contact_us'];

// Public — called from every public v1 page via fnTrackPageview()/fnTrackEvent()
// in admin-common.js. Anonymous: no IP address stored, no link to a logged-in
// identity, session id lives only in the visitor's own sessionStorage.
router.post('/track', async (req, res) => {
  const b = req.body || {};
  const sessionId = b.sessionId;
  const eventType = b.eventType;
  if (!SESSION_ID_PATTERN.test(sessionId) || !EVENT_TYPE_PATTERN.test(eventType)) {
    return res.status(400).json({ error: 'Invalid session id or event type' });
  }

  const page = (b.page || '').slice(0, 512);
  const label = (b.label || '').slice(0, 255);
  const referrer = (b.referrer || '').slice(0, 512);
  const userAgent = (req.headers['user-agent'] || '').slice(0, 255);

  await pool.query(
    `INSERT INTO analytics_sessions (id, entry_page, referrer, user_agent)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE last_seen = NOW()`,
    [sessionId, page, referrer, userAgent]
  );
  await pool.query(
    'INSERT INTO analytics_events (session_id, event_type, page, label) VALUES (?, ?, ?, ?)',
    [sessionId, eventType, page, label]
  );
  res.status(204).end();
});

router.get('/summary', requireAuth, async (req, res) => {
  const [[sessionTotals]] = await pool.query(
    `SELECT COUNT(*) AS total,
       SUM(DATE(first_seen) = CURDATE()) AS today,
       SUM(first_seen >= NOW() - INTERVAL 7 DAY) AS last7Days
     FROM analytics_sessions`
  );

  const [[pageStats]] = await pool.query(
    `SELECT COUNT(*) AS total_pageviews,
       COUNT(DISTINCT session_id) AS sessions_with_pageview
     FROM analytics_events WHERE event_type = 'pageview'`
  );
  const avgPagesPerSession = pageStats.sessions_with_pageview > 0
    ? pageStats.total_pageviews / pageStats.sessions_with_pageview
    : 0;

  const [[bounceRow]] = await pool.query(
    `SELECT COUNT(*) AS single_page_sessions FROM (
       SELECT session_id FROM analytics_events WHERE event_type = 'pageview'
       GROUP BY session_id HAVING COUNT(*) = 1
     ) t`
  );
  const bounceRate = pageStats.sessions_with_pageview > 0
    ? bounceRow.single_page_sessions / pageStats.sessions_with_pageview
    : null;

  const [topEntryPages] = await pool.query(
    `SELECT entry_page AS page, COUNT(*) AS count FROM analytics_sessions
     WHERE entry_page IS NOT NULL AND entry_page != ''
     GROUP BY entry_page ORDER BY count DESC LIMIT 8`
  );

  const [topEvents] = await pool.query(
    `SELECT event_type, label, COUNT(*) AS count FROM analytics_events
     WHERE event_type != 'pageview' AND label IS NOT NULL AND label != ''
     GROUP BY event_type, label ORDER BY count DESC LIMIT 10`
  );

  res.json({
    sessionsToday: sessionTotals.today || 0,
    sessionsLast7Days: sessionTotals.last7Days || 0,
    sessionsAllTime: sessionTotals.total || 0,
    avgPagesPerSession,
    bounceRate,
    topEntryPages,
    topEvents,
  });
});

// Funnel view: how far visitors get through Visited -> Explored -> Showed
// intent, over a date range (default last 30 days). Counts are of distinct
// sessions, not events, so a session that both viewed a book and added to
// cart only counts once at each stage it reached.
router.get('/funnel', requireAuth, async (req, res) => {
  const today = new Date();
  const defaultStart = new Date(today);
  defaultStart.setDate(defaultStart.getDate() - 29);

  let start = DATE_PATTERN.test(req.query.start) ? req.query.start : isoDate(defaultStart);
  let end = DATE_PATTERN.test(req.query.end) ? req.query.end : isoDate(today);
  if (start > end) [start, end] = [end, start];

  const [[visitedRow]] = await pool.query(
    'SELECT COUNT(*) AS count FROM analytics_sessions WHERE DATE(first_seen) BETWEEN ? AND ?',
    [start, end]
  );
  const [[engagedRow]] = await pool.query(
    `SELECT COUNT(DISTINCT s.id) AS count FROM analytics_sessions s
     JOIN analytics_events e ON e.session_id = s.id
     WHERE DATE(s.first_seen) BETWEEN ? AND ? AND e.event_type IN (?)`,
    [start, end, ENGAGED_EVENTS]
  );
  const [[intentRow]] = await pool.query(
    `SELECT COUNT(DISTINCT s.id) AS count FROM analytics_sessions s
     JOIN analytics_events e ON e.session_id = s.id
     WHERE DATE(s.first_seen) BETWEEN ? AND ? AND e.event_type IN (?)`,
    [start, end, INTENT_EVENTS]
  );
  const [intentBreakdown] = await pool.query(
    `SELECT e.event_type, COUNT(DISTINCT e.session_id) AS count FROM analytics_events e
     JOIN analytics_sessions s ON s.id = e.session_id
     WHERE DATE(s.first_seen) BETWEEN ? AND ? AND e.event_type IN (?)
     GROUP BY e.event_type`,
    [start, end, INTENT_EVENTS]
  );

  res.json({
    start,
    end,
    stages: [
      { key: 'visited', label: 'Visited the site', count: visitedRow.count },
      { key: 'engaged', label: 'Explored content', count: engagedRow.count },
      { key: 'intent', label: 'Showed buying/contact intent', count: intentRow.count },
    ],
    intentBreakdown: intentBreakdown.map(r => ({ eventType: r.event_type, count: r.count })),
  });
});

router.get('/sessions', requireAuth, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const [sessions] = await pool.query(
    `SELECT s.*, COUNT(e.id) AS event_count
     FROM analytics_sessions s LEFT JOIN analytics_events e ON e.session_id = s.id
     GROUP BY s.id ORDER BY s.last_seen DESC LIMIT ?`,
    [limit]
  );
  res.json({
    sessions: sessions.map(s => ({
      id: s.id,
      entryPage: s.entry_page,
      referrer: s.referrer,
      firstSeen: s.first_seen,
      lastSeen: s.last_seen,
      eventCount: s.event_count,
    })),
  });
});

router.get('/sessions/:id', requireAuth, async (req, res) => {
  const [[session]] = await pool.query('SELECT * FROM analytics_sessions WHERE id = ?', [req.params.id]);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const [events] = await pool.query(
    'SELECT event_type, page, label, created_at FROM analytics_events WHERE session_id = ? ORDER BY created_at ASC',
    [req.params.id]
  );

  res.json({
    session: {
      id: session.id,
      entryPage: session.entry_page,
      referrer: session.referrer,
      userAgent: session.user_agent,
      firstSeen: session.first_seen,
      lastSeen: session.last_seen,
    },
    path: events.map(e => ({ eventType: e.event_type, page: e.page, label: e.label, at: e.created_at })),
  });
});

module.exports = router;
