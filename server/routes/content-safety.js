// FNE-side Content Safety administration: safety_rules (category -> action
// thresholds) and safety_terms (FNE + school-specific dictionary). This is
// the "no hardcoded judgment calls" surface — every threshold in
// lib/safety/policy.js is a row here, editable without a code change.
// requireAuth = FNE admin session (server/middleware/auth.js), same guard
// every other admin-* route in this app uses.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const ACTIONS = ['allow', 'allow_log', 'block', 'block_alert', 'critical_block_alert'];

// ── Rules ────────────────────────────────────────────────────────────────

router.get('/rules', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM safety_rules ORDER BY category, min_severity');
  res.json({ rules: rows });
});

router.post('/rules', requireAuth, async (req, res) => {
  const b = req.body || {};
  const category = (b.category || '').trim();
  const minSeverity = parseInt(b.minSeverity, 10);
  const action = b.action;
  const isLocked = b.isLocked === true ? 1 : 0;
  const schoolDomain = (b.schoolDomain || '').trim() || null;

  if (!category) return res.status(400).json({ error: 'Category is required' });
  if (isNaN(minSeverity) || minSeverity < 0 || minSeverity > 4) return res.status(400).json({ error: 'Minimum severity must be 0–4' });
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action' });

  const [result] = await pool.query(
    'INSERT INTO safety_rules (scope, school_domain, category, min_severity, action, is_locked, created_by_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [schoolDomain ? 'school' : 'fne', schoolDomain, category, minSeverity, action, isLocked, req.user.userId]
  );
  res.status(201).json({ id: result.insertId });
});

router.put('/rules/:id', requireAuth, async (req, res) => {
  const [[rule]] = await pool.query('SELECT * FROM safety_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Not found' });

  const b = req.body || {};
  const action = b.action !== undefined ? b.action : rule.action;
  const minSeverity = b.minSeverity !== undefined ? parseInt(b.minSeverity, 10) : rule.min_severity;
  if (!ACTIONS.includes(action)) return res.status(400).json({ error: 'Invalid action' });
  if (isNaN(minSeverity) || minSeverity < 0 || minSeverity > 4) return res.status(400).json({ error: 'Minimum severity must be 0–4' });

  await pool.query('UPDATE safety_rules SET action = ?, min_severity = ? WHERE id = ?', [action, minSeverity, req.params.id]);
  res.json({ ok: true });
});

router.delete('/rules/:id', requireAuth, async (req, res) => {
  const [[rule]] = await pool.query('SELECT is_locked FROM safety_rules WHERE id = ?', [req.params.id]);
  if (!rule) return res.status(404).json({ error: 'Not found' });
  if (rule.is_locked) return res.status(403).json({ error: 'This is an FNE-locked guardrail and cannot be removed' });
  await pool.query('DELETE FROM safety_rules WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

// ── Terms ────────────────────────────────────────────────────────────────

router.get('/terms', requireAuth, async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM safety_terms ORDER BY school_domain IS NULL DESC, category, term');
  res.json({ terms: rows });
});

router.post('/terms', requireAuth, async (req, res) => {
  const b = req.body || {};
  const term = (b.term || '').trim();
  const category = (b.category || '').trim();
  const severity = parseInt(b.severity, 10);
  const isAllowlist = b.isAllowlist === true ? 1 : 0;
  const schoolDomain = (b.schoolDomain || '').trim() || null;

  if (!term) return res.status(400).json({ error: 'Term is required' });
  if (!category) return res.status(400).json({ error: 'Category is required' });
  if (isNaN(severity) || severity < 0 || severity > 4) return res.status(400).json({ error: 'Severity must be 0–4' });

  const [result] = await pool.query(
    'INSERT INTO safety_terms (scope, school_domain, term, category, severity, is_allowlist, created_by_admin_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [schoolDomain ? 'school' : 'fne', schoolDomain, term, category, severity, isAllowlist, req.user.userId]
  );
  res.status(201).json({ id: result.insertId });
});

router.delete('/terms/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM safety_terms WHERE id = ?', [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
