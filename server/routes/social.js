const express = require('express');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const pool = require('../db/pool');
const { SITE_COOKIE_NAME } = require('../lib/session');
const { hasActiveLicense } = require('../lib/access');
const { requireAuth } = require('../middleware/auth');
const { ensureProfile } = require('../lib/social-groups');
const gateway = require('../lib/safety/gateway');
const { resolveSchoolDomainForSocialGroup, resolveSchoolDomainForTeacher } = require('../lib/safety/school-context');

// ── File upload for social posts ──────────────────────────────────────────

const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads');
const socialUploadsDir = path.join(uploadsDir, 'social');
fs.mkdirSync(socialUploadsDir, { recursive: true });

const SOCIAL_ALLOWED = /^(image\/|video\/|application\/pdf|application\/msword|application\/vnd\.|text\/plain)/;

const socialUploadMw = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, socialUploadsDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!SOCIAL_ALLOWED.test(file.mimetype)) return cb(new Error('Unsupported file type: ' + file.mimetype));
    cb(null, true);
  },
});

const router = express.Router();

// ── Site-user social access ────────────────────────────────────────────────

async function requireSocialAccess(req, res, next) {
  const token = req.cookies[SITE_COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Login required' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.SESSION_SECRET);
  } catch {
    return res.status(401).json({ error: 'Login required' });
  }
  const [rows] = await pool.query('SELECT * FROM site_users WHERE id = ?', [payload.userId]);
  if (!rows[0]) return res.status(401).json({ error: 'Login required' });
  // Same revocation check requireSiteAuth already enforces — without this,
  // a password change (or any of the license-revocation paths that now
  // bump this) doesn't actually invalidate an old token's community access,
  // only its access to license-gated features elsewhere.
  if (rows[0].session_invalidated_at && payload.iat * 1000 < new Date(rows[0].session_invalidated_at).getTime()) {
    return res.status(401).json({ error: 'Login required' });
  }
  req.siteUser = rows[0];

  const licensed = await hasActiveLicense(rows[0].id);
  if (!licensed) {
    return res.status(403).json({ error: 'A valid license is required to access the community.' });
  }
  next();
}

// ── Upload attachments ────────────────────────────────────────────────────

router.post('/upload', requireSocialAccess, socialUploadMw.array('files', 5), async (req, res) => {
  if (!req.files || !req.files.length) return res.status(400).json({ error: 'No files uploaded' });

  // Content Safety Gateway (SOCIAL_IMAGE) — screen every uploaded image
  // before it's ever returned to the client as an attachable URL. Non-image
  // files (video/pdf/doc) pass through unscreened in Phase 1 (nsfwjs/OpenAI
  // omni-moderation image support only cover still images).
  const schoolDomain = await resolveSchoolDomainForTeacher(req.siteUser.id);
  const imageFiles = req.files.filter(f => f.mimetype.startsWith('image/'));
  if (imageFiles.length) {
    const images = imageFiles.map(f => ({ buffer: fs.readFileSync(f.path), mimetype: f.mimetype }));
    const result = await gateway.screenContent({
      contentContext: 'SOCIAL_IMAGE',
      images,
      authorSiteUserId: req.siteUser.id,
      schoolDomain,
    });
    if (!gateway.isPublishable(result.decision)) {
      for (const f of req.files) fs.unlink(f.path, () => {});
      return res.status(422).json({ error: result.message });
    }
  }

  const prefix = (process.env.UPLOADS_URL_PREFIX || '/uploads/') + 'social/';
  const attachments = req.files.map(f => ({
    type: f.mimetype.startsWith('image/') ? 'image'
        : f.mimetype.startsWith('video/') ? 'video'
        : 'file',
    url: prefix + f.filename,
    name: f.originalname,
    size: f.size,
  }));
  res.status(201).json({ attachments });
});

// ── Groups — admin CRUD ────────────────────────────────────────────────────

// Admin: create a group
router.post('/groups', requireAuth, async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  const description = (b.description || '').trim() || null;
  const isPublic = b.isPublic !== false ? 1 : 0;

  const [result] = await pool.query(
    "INSERT INTO social_groups (name, type, description, is_public) VALUES (?, 'custom', ?, ?)",
    [name, description, isPublic]
  );
  const [[group]] = await pool.query(
    'SELECT sg.*, COUNT(DISTINCT sgm.user_id) AS member_count, COUNT(DISTINCT sp.id) AS post_count FROM social_groups sg LEFT JOIN social_group_members sgm ON sgm.group_id = sg.id LEFT JOIN social_posts sp ON sp.group_id = sg.id AND sp.deleted_at IS NULL WHERE sg.id = ? GROUP BY sg.id',
    [result.insertId]
  );
  res.status(201).json({ group });
});

// Admin: edit a group
router.put('/groups/:id', requireAuth, async (req, res) => {
  const b = req.body || {};
  const name = (b.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Group name is required' });
  await pool.query(
    'UPDATE social_groups SET name = ?, description = ?, is_public = ? WHERE id = ?',
    [name, (b.description || '').trim() || null, b.isPublic !== false ? 1 : 0, req.params.id]
  );
  res.json({ ok: true });
});

// Admin: delete a group
router.delete('/groups/:id', requireAuth, async (req, res) => {
  const [result] = await pool.query('DELETE FROM social_groups WHERE id = ?', [req.params.id]);
  if (!result.affectedRows) return res.status(404).json({ error: 'Group not found' });
  res.json({ ok: true });
});

// ── Groups — user browsing & joining ──────────────────────────────────────

// All public groups with the current user's membership status
// IMPORTANT: this route must be declared before /:groupId routes
router.get('/groups/browse', requireSocialAccess, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sg.id, sg.name, sg.description, sg.created_at,
            COUNT(DISTINCT sgm.user_id) AS member_count,
            MAX(IF(sgm.user_id = ?, 1, 0)) AS is_member
     FROM social_groups sg
     LEFT JOIN social_group_members sgm ON sgm.group_id = sg.id
     WHERE sg.is_public = 1
     GROUP BY sg.id
     ORDER BY sg.name`,
    [req.siteUser.id]
  );
  res.json({ groups: rows });
});

// User: list groups the current user has joined
router.get('/groups', requireSocialAccess, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sg.id, sg.name, sg.description,
            COUNT(DISTINCT sgm2.user_id) AS member_count
     FROM social_groups sg
     JOIN social_group_members sgm ON sgm.group_id = sg.id AND sgm.user_id = ?
     LEFT JOIN social_group_members sgm2 ON sgm2.group_id = sg.id
     WHERE sg.is_public = 1
     GROUP BY sg.id
     ORDER BY sg.name`,
    [req.siteUser.id]
  );
  res.json({ groups: rows });
});

// Unread post counts across all joined groups for the current user
// IMPORTANT: must be declared before /:groupId routes
router.get('/groups/unread', requireSocialAccess, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT
       sgm.group_id,
       COUNT(sp.id) AS unread_count
     FROM social_group_members sgm
     LEFT JOIN social_group_reads sgr
       ON sgr.group_id = sgm.group_id AND sgr.user_id = sgm.user_id
     LEFT JOIN social_posts sp
       ON sp.group_id = sgm.group_id
       AND sp.deleted_at IS NULL
       AND sp.author_id != sgm.user_id
       AND sp.created_at > COALESCE(sgr.last_read_at, '1970-01-01 00:00:00')
     WHERE sgm.user_id = ?
     GROUP BY sgm.group_id`,
    [req.siteUser.id]
  );
  res.json({ unread: rows });
});

// Mark a group as fully read (upsert last_read_at to now)
router.post('/groups/:groupId/read', requireSocialAccess, async (req, res) => {
  await pool.query(
    `INSERT INTO social_group_reads (group_id, user_id, last_read_at)
     VALUES (?, ?, NOW())
     ON DUPLICATE KEY UPDATE last_read_at = NOW()`,
    [req.params.groupId, req.siteUser.id]
  );
  res.json({ ok: true });
});

// User: join a public group
router.post('/groups/:groupId/join', requireSocialAccess, async (req, res) => {
  const groupId = Number(req.params.groupId);
  const [[group]] = await pool.query('SELECT id FROM social_groups WHERE id = ? AND is_public = 1', [groupId]);
  if (!group) return res.status(404).json({ error: 'Group not found or not public' });
  await ensureProfile(req.siteUser.id);
  await pool.query(
    'INSERT IGNORE INTO social_group_members (group_id, user_id) VALUES (?, ?)',
    [groupId, req.siteUser.id]
  );
  res.json({ ok: true });
});

// User: leave a group
router.delete('/groups/:groupId/leave', requireSocialAccess, async (req, res) => {
  await pool.query(
    'DELETE FROM social_group_members WHERE group_id = ? AND user_id = ?',
    [req.params.groupId, req.siteUser.id]
  );
  res.json({ ok: true });
});

// ── Posts ──────────────────────────────────────────────────────────────────

// Poll feed for a group. ?since=ISO limits to posts newer than that timestamp.
router.get('/groups/:groupId/posts', requireSocialAccess, async (req, res) => {
  const groupId = Number(req.params.groupId);

  const [mem] = await pool.query(
    'SELECT 1 FROM social_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.siteUser.id]
  );
  if (!mem[0]) return res.status(403).json({ error: 'Not a member of this group' });

  const since = req.query.since;
  let sql = `
    SELECT p.id, p.group_id, p.author_id, p.content, p.attachments,
           p.created_at, p.updated_at,
           su.first_name, su.last_name,
           sp.bio_consent, sp.avatar_url,
           (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id = p.id) AS reaction_count,
           (SELECT COUNT(*) FROM social_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
           (SELECT r2.reaction FROM social_reactions r2 WHERE r2.post_id = p.id AND r2.user_id = ?) AS my_reaction
    FROM social_posts p
    JOIN site_users su ON su.id = p.author_id
    LEFT JOIN social_profiles sp ON sp.user_id = p.author_id
    WHERE p.group_id = ? AND p.deleted_at IS NULL`;
  const params = [req.siteUser.id, groupId];
  if (since) {
    sql += ' AND p.created_at > ?';
    params.push(since);
  }
  sql += ' ORDER BY p.created_at DESC LIMIT 50';

  const [rows] = await pool.query(sql, params);
  res.json({ posts: rows });
});

// Create a post in a group
router.post('/groups/:groupId/posts', requireSocialAccess, async (req, res) => {
  const groupId = Number(req.params.groupId);
  const content = (req.body && req.body.content || '').trim();
  const hasAttachments = req.body && Array.isArray(req.body.attachments) && req.body.attachments.length > 0;
  if (!content && !hasAttachments) return res.status(400).json({ error: 'Content or attachment is required' });

  const [mem] = await pool.query(
    'SELECT 1 FROM social_group_members WHERE group_id = ? AND user_id = ?',
    [groupId, req.siteUser.id]
  );
  if (!mem[0]) return res.status(403).json({ error: 'Not a member of this group' });

  // Content Safety Gateway (SOCIAL_POST) — text only; any attached images
  // were already screened at upload time (see POST /upload above).
  if (content) {
    const schoolDomain = await resolveSchoolDomainForSocialGroup(groupId);
    const screen = await gateway.screenContent({
      contentContext: 'SOCIAL_POST',
      text: content,
      authorSiteUserId: req.siteUser.id,
      schoolDomain,
    });
    if (!gateway.isPublishable(screen.decision)) {
      return res.status(422).json({ error: screen.message });
    }
  }

  const attachments = req.body && req.body.attachments ? JSON.stringify(req.body.attachments) : null;
  const [result] = await pool.query(
    'INSERT INTO social_posts (group_id, author_id, content, attachments) VALUES (?, ?, ?, ?)',
    [groupId, req.siteUser.id, content, attachments]
  );

  const [[post]] = await pool.query(
    `SELECT p.id, p.group_id, p.author_id, p.content, p.attachments, p.created_at, p.updated_at,
            su.first_name, su.last_name, sp.bio_consent, sp.avatar_url,
            0 AS reaction_count, 0 AS comment_count, NULL AS my_reaction
     FROM social_posts p
     JOIN site_users su ON su.id = p.author_id
     LEFT JOIN social_profiles sp ON sp.user_id = p.author_id
     WHERE p.id = ?`,
    [result.insertId]
  );
  res.status(201).json({ post });
});

// Admin: soft-delete a post
router.delete('/posts/:postId', requireAuth, async (req, res) => {
  const [result] = await pool.query(
    "UPDATE social_posts SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [req.params.postId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Post not found' });
  res.json({ ok: true });
});

// ── Reactions ──────────────────────────────────────────────────────────────

router.post('/posts/:postId/react', requireSocialAccess, async (req, res) => {
  const postId = Number(req.params.postId);
  const reaction = (req.body && req.body.reaction) || 'like';

  const [existing] = await pool.query(
    'SELECT 1 FROM social_reactions WHERE post_id = ? AND user_id = ?',
    [postId, req.siteUser.id]
  );
  if (existing[0]) {
    await pool.query('DELETE FROM social_reactions WHERE post_id = ? AND user_id = ?', [postId, req.siteUser.id]);
    res.json({ toggled: 'removed' });
  } else {
    await pool.query(
      'INSERT INTO social_reactions (post_id, user_id, reaction) VALUES (?, ?, ?)',
      [postId, req.siteUser.id, reaction]
    );
    res.json({ toggled: 'added', reaction });
  }
});

// ── Comments ───────────────────────────────────────────────────────────────

router.get('/posts/:postId/comments', requireSocialAccess, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.id, c.post_id, c.author_id, c.content, c.created_at,
            su.first_name, su.last_name, sp.avatar_url
     FROM social_comments c
     JOIN site_users su ON su.id = c.author_id
     LEFT JOIN social_profiles sp ON sp.user_id = c.author_id
     WHERE c.post_id = ? AND c.deleted_at IS NULL
     ORDER BY c.created_at ASC`,
    [req.params.postId]
  );
  res.json({ comments: rows });
});

router.post('/posts/:postId/comments', requireSocialAccess, async (req, res) => {
  const postId = Number(req.params.postId);
  const content = (req.body && req.body.content || '').trim();
  if (!content) return res.status(400).json({ error: 'Content is required' });

  const [[post]] = await pool.query('SELECT id, group_id FROM social_posts WHERE id = ? AND deleted_at IS NULL', [postId]);
  if (!post) return res.status(404).json({ error: 'Post not found' });

  // Content Safety Gateway (SOCIAL_COMMENT)
  const schoolDomain = await resolveSchoolDomainForSocialGroup(post.group_id);
  const screen = await gateway.screenContent({
    contentContext: 'SOCIAL_COMMENT',
    text: content,
    authorSiteUserId: req.siteUser.id,
    schoolDomain,
  });
  if (!gateway.isPublishable(screen.decision)) {
    return res.status(422).json({ error: screen.message });
  }

  const [result] = await pool.query(
    'INSERT INTO social_comments (post_id, author_id, content) VALUES (?, ?, ?)',
    [postId, req.siteUser.id, content]
  );

  const [[comment]] = await pool.query(
    `SELECT c.id, c.post_id, c.author_id, c.content, c.created_at,
            su.first_name, su.last_name, sp.avatar_url
     FROM social_comments c
     JOIN site_users su ON su.id = c.author_id
     LEFT JOIN social_profiles sp ON sp.user_id = c.author_id
     WHERE c.id = ?`,
    [result.insertId]
  );
  res.status(201).json({ comment });
});

// Admin: soft-delete a comment
router.delete('/comments/:commentId', requireAuth, async (req, res) => {
  const [result] = await pool.query(
    "UPDATE social_comments SET deleted_at = NOW() WHERE id = ? AND deleted_at IS NULL",
    [req.params.commentId]
  );
  if (!result.affectedRows) return res.status(404).json({ error: 'Comment not found' });
  res.json({ ok: true });
});

// ── Direct Messages ────────────────────────────────────────────────────────

router.get('/messages/conversations', requireSocialAccess, async (req, res) => {
  const userId = req.siteUser.id;
  const [rows] = await pool.query(
    `SELECT
       partner_id,
       su.first_name, su.last_name, sp.avatar_url,
       latest_msg, latest_at,
       SUM(unread) AS unread_count
     FROM (
       SELECT
         IF(sender_id = ?, recipient_id, sender_id) AS partner_id,
         content AS latest_msg,
         created_at AS latest_at,
         IF(recipient_id = ? AND read_at IS NULL AND deleted_at IS NULL, 1, 0) AS unread
       FROM social_messages
       WHERE (sender_id = ? OR recipient_id = ?) AND deleted_at IS NULL
     ) t
     JOIN site_users su ON su.id = t.partner_id
     LEFT JOIN social_profiles sp ON sp.user_id = t.partner_id
     GROUP BY partner_id, su.first_name, su.last_name, sp.avatar_url
     ORDER BY MAX(latest_at) DESC`,
    [userId, userId, userId, userId]
  );
  res.json({ conversations: rows });
});

router.get('/messages', requireSocialAccess, async (req, res) => {
  const userId = req.siteUser.id;
  const partnerId = Number(req.query.with);
  if (!partnerId) return res.status(400).json({ error: 'with= parameter required' });

  const since = req.query.since;
  let sql = `SELECT id, sender_id, recipient_id, content, attachments, read_at, created_at
             FROM social_messages
             WHERE deleted_at IS NULL
             AND ((sender_id = ? AND recipient_id = ?) OR (sender_id = ? AND recipient_id = ?))`;
  const params = [userId, partnerId, partnerId, userId];
  if (since) {
    sql += ' AND created_at > ?';
    params.push(since);
  }
  sql += ' ORDER BY created_at ASC LIMIT 100';

  const [rows] = await pool.query(sql, params);

  await pool.query(
    'UPDATE social_messages SET read_at = NOW() WHERE sender_id = ? AND recipient_id = ? AND read_at IS NULL AND deleted_at IS NULL',
    [partnerId, userId]
  );

  res.json({ messages: rows });
});

router.post('/messages', requireSocialAccess, async (req, res) => {
  const content = (req.body && req.body.content || '').trim();
  const recipientId = Number(req.body && req.body.recipientId);
  if (!content) return res.status(400).json({ error: 'Content is required' });
  if (!recipientId || recipientId === req.siteUser.id) return res.status(400).json({ error: 'Invalid recipient' });

  const [recipRows] = await pool.query('SELECT id, email FROM site_users WHERE id = ?', [recipientId]);
  if (!recipRows[0]) return res.status(404).json({ error: 'Recipient not found' });
  const rLicensed = await hasActiveLicense(recipientId);
  if (!rLicensed) return res.status(403).json({ error: 'Recipient is not a community member' });

  // Content Safety Gateway (SOCIAL_DM) — no group to resolve school context
  // from, so best-effort resolve via the sender's own teacher/school
  // affiliation (lib/safety/school-context.js).
  const schoolDomain = await resolveSchoolDomainForTeacher(req.siteUser.id);
  const screen = await gateway.screenContent({
    contentContext: 'SOCIAL_DM',
    text: content,
    authorSiteUserId: req.siteUser.id,
    schoolDomain,
  });
  if (!gateway.isPublishable(screen.decision)) {
    return res.status(422).json({ error: screen.message });
  }

  const attachments = req.body && req.body.attachments ? JSON.stringify(req.body.attachments) : null;
  const [result] = await pool.query(
    'INSERT INTO social_messages (sender_id, recipient_id, content, attachments) VALUES (?, ?, ?, ?)',
    [req.siteUser.id, recipientId, content, attachments]
  );

  const [[msg]] = await pool.query(
    'SELECT id, sender_id, recipient_id, content, attachments, read_at, created_at FROM social_messages WHERE id = ?',
    [result.insertId]
  );
  res.status(201).json({ message: msg });
});

// ── Profiles ───────────────────────────────────────────────────────────────

router.get('/profile', requireSocialAccess, async (req, res) => {
  await ensureProfile(req.siteUser.id);
  const [[user]] = await pool.query(
    `SELECT su.id, su.first_name, su.last_name, su.email,
            sp.bio, sp.bio_consent, sp.avatar_url,
            COALESCE(bgp.show_badges, 1) AS show_badges,
            (SELECT p.school_domain FROM license_seats ls
             JOIN purchases p ON p.id = ls.purchase_id
             WHERE ls.registered_site_user_id = su.id AND ls.status = 'registered' LIMIT 1) AS school_domain
     FROM site_users su
     LEFT JOIN social_profiles sp ON sp.user_id = su.id
     LEFT JOIN brain_game_privacy bgp ON bgp.user_id = su.id
     WHERE su.id = ?`,
    [req.siteUser.id]
  );
  let featuredBadges = [];
  try {
    const [rows] = await pool.query(
      `SELECT b.name, b.emoji, b.rarity, ub.featured_position
       FROM user_brain_badges ub JOIN brain_badges b ON b.id = ub.badge_id
       WHERE ub.user_id = ? AND ub.featured = 1 ORDER BY ub.featured_position`,
      [req.siteUser.id]
    );
    featuredBadges = rows;
  } catch {}
  res.json({ profile: { ...user, featuredBadges } });
});

router.put('/profile', requireSocialAccess, async (req, res) => {
  const b = req.body || {};
  await ensureProfile(req.siteUser.id);
  await pool.query(
    'UPDATE social_profiles SET bio = ?, bio_consent = ? WHERE user_id = ?',
    [(b.bio || '').trim() || null, b.bioConsent ? 1 : 0, req.siteUser.id]
  );
  if (typeof b.showBadges === 'boolean') {
    try {
      await pool.query(
        `INSERT INTO brain_game_privacy (user_id, show_badges) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE show_badges = VALUES(show_badges)`,
        [req.siteUser.id, b.showBadges ? 1 : 0]
      );
    } catch {}
  }
  res.json({ ok: true });
});

router.get('/profile/:userId', requireSocialAccess, async (req, res) => {
  const [[user]] = await pool.query(
    `SELECT su.id, su.first_name, su.last_name,
            IF(sp.bio_consent = 1, su.email, NULL) AS email,
            IF(sp.bio_consent = 1, sp.bio, NULL) AS bio,
            sp.bio_consent, sp.avatar_url,
            COALESCE(bgp.show_badges, 1) AS show_badges,
            (SELECT p.school_domain FROM license_seats ls
             JOIN purchases p ON p.id = ls.purchase_id
             WHERE ls.registered_site_user_id = su.id AND ls.status = 'registered' LIMIT 1) AS school_domain
     FROM site_users su
     LEFT JOIN social_profiles sp ON sp.user_id = su.id
     LEFT JOIN brain_game_privacy bgp ON bgp.user_id = su.id
     WHERE su.id = ?`,
    [req.params.userId]
  );
  if (!user) return res.status(404).json({ error: 'Member not found' });
  let featuredBadges = [];
  if (user.show_badges) {
    try {
      const [rows] = await pool.query(
        `SELECT b.name, b.emoji, b.rarity, ub.featured_position
         FROM user_brain_badges ub JOIN brain_badges b ON b.id = ub.badge_id
         WHERE ub.user_id = ? AND ub.featured = 1 ORDER BY ub.featured_position`,
        [req.params.userId]
      );
      featuredBadges = rows;
    } catch {}
  }
  res.json({ profile: { ...user, featuredBadges } });
});

// ── Members list ───────────────────────────────────────────────────────────

router.get('/members', requireSocialAccess, async (req, res) => {
  const q = (req.query.q || '').trim();
  let sql = `SELECT su.id, su.first_name, su.last_name, sp.avatar_url, sp.bio_consent,
                    IF(sp.bio_consent = 1, su.email, NULL) AS email,
                    (SELECT p.school_domain FROM license_seats ls
                     JOIN purchases p ON p.id = ls.purchase_id
                     WHERE ls.registered_site_user_id = su.id AND ls.status = 'registered' LIMIT 1) AS school_domain
             FROM site_users su
             INNER JOIN social_profiles sp ON sp.user_id = su.id
             WHERE 1=1`;
  const params = [];
  if (q) {
    sql += ' AND (su.first_name LIKE ? OR su.last_name LIKE ? OR su.email LIKE ?)';
    const like = `%${q}%`;
    params.push(like, like, like);
  }
  sql += ' ORDER BY su.first_name, su.last_name LIMIT 100';
  const [rows] = await pool.query(sql, params);
  res.json({ members: rows });
});

// ── Admin moderation ───────────────────────────────────────────────────────

router.get('/admin/posts', requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = 25;
  const offset = (page - 1) * limit;
  const [rows] = await pool.query(
    `SELECT p.id, p.group_id, p.author_id, p.content, p.attachments, p.created_at, p.deleted_at,
            sg.name AS group_name,
            su.first_name, su.last_name, su.email,
            (SELECT COUNT(*) FROM social_comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL) AS comment_count,
            (SELECT COUNT(*) FROM social_reactions r WHERE r.post_id = p.id) AS reaction_count
     FROM social_posts p
     JOIN social_groups sg ON sg.id = p.group_id
     JOIN site_users su ON su.id = p.author_id
     ORDER BY p.created_at DESC
     LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM social_posts');
  res.json({ posts: rows, total, page, limit });
});

router.get('/admin/groups', requireAuth, async (req, res) => {
  const [rows] = await pool.query(
    `SELECT sg.id, sg.name, sg.type, sg.description, sg.is_public, sg.created_at,
            COUNT(DISTINCT sgm.user_id) AS member_count,
            COUNT(DISTINCT sp.id) AS post_count
     FROM social_groups sg
     LEFT JOIN social_group_members sgm ON sgm.group_id = sg.id
     LEFT JOIN social_posts sp ON sp.group_id = sg.id AND sp.deleted_at IS NULL
     GROUP BY sg.id
     ORDER BY sg.name`
  );
  res.json({ groups: rows });
});

// Multer error handler (must be 4-param)
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  res.status(400).json({ error: err.message || 'Upload failed' });
});

module.exports = router;
