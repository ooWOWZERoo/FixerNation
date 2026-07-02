const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../db/pool');

const router = express.Router();

const COOKIE_NAME = 'fn_session';
const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function setSessionCookie(res, user) {
  const token = jwt.sign({ userId: user.id, username: user.username }, process.env.SESSION_SECRET, {
    expiresIn: '24h',
  });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: COOKIE_MAX_AGE_MS,
  });
}

router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const [rows] = await pool.query('SELECT id, username, password_hash FROM admin_users WHERE username = ?', [username]);
  const user = rows[0];
  if (!user) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  setSessionCookie(res, user);
  res.json({ ok: true, username: user.username });
});

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.json({ loggedIn: false });
  }
  try {
    const payload = jwt.verify(token, process.env.SESSION_SECRET);
    res.json({ loggedIn: true, username: payload.username });
  } catch {
    res.json({ loggedIn: false });
  }
});

module.exports = { router, COOKIE_NAME };
