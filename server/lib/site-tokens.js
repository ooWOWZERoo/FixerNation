const crypto = require('crypto');
const pool = require('../db/pool');

async function createToken(userId, type, ttlMs) {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + ttlMs);
  await pool.query('INSERT INTO site_user_tokens (user_id, token, type, expires_at) VALUES (?, ?, ?, ?)', [userId, token, type, expiresAt]);
  return token;
}

async function consumeToken(token, type) {
  const [rows] = await pool.query(
    'SELECT * FROM site_user_tokens WHERE token = ? AND type = ? AND expires_at > NOW()',
    [token, type]
  );
  if (!rows[0]) return null;
  await pool.query('DELETE FROM site_user_tokens WHERE id = ?', [rows[0].id]);
  return rows[0];
}

module.exports = { createToken, consumeToken };
