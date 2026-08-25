// Local lexical/phrase screening layer — @2toad/profanity (spec's own
// reference source R7) for general profanity, plus FNE + school-specific
// terms from safety_terms for anything with its own category/severity
// (slurs, campus-specific coded terms, harmful nicknames, etc.).
//
// Runs against BOTH the plain-lowercased text and a punctuation/spacing-
// collapsed variant (lib/safety/normalize.js) so spaced-out or hyphenated
// evasion ("b a d w o r d") is still caught, while whole-word matching on
// the normal-spaced variant avoids the classic substring false positive
// (spec AC-003, e.g. "arsenic" vs "arse").
const { Profanity } = require('@2toad/profanity');
const pool = require('../../db/pool');
const { normalizeForAnalysis } = require('./normalize');

const profanity = new Profanity({ wholeWord: true });

let termsCache = null;
let termsCacheAt = 0;
const TERMS_CACHE_MS = 30 * 1000; // school/FNE term edits take effect within 30s, not instantly — acceptable for a moderation dictionary, avoids a DB round-trip on every single scan

async function loadTerms() {
  const now = Date.now();
  if (termsCache && now - termsCacheAt < TERMS_CACHE_MS) return termsCache;
  const [rows] = await pool.query('SELECT term, category, severity, is_allowlist, school_domain FROM safety_terms');
  termsCache = rows;
  termsCacheAt = now;
  return rows;
}

function wholeWordMatch(haystack, term) {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
}

// spec §20's own severity table assigns "Profanity, explicit vulgarity" to
// severity tier 2 ("Prohibited") — this is the spec's documented mapping,
// not an implementation judgment call, so it's a fixed constant here rather
// than an admin-editable value. What IS admin-editable is what ACTION fires
// at severity 2 for category "profanity" (safety_rules, looked up in
// policy.js) — this function only reports that a hit occurred.
const BUILTIN_PROFANITY_SEVERITY = 2;

async function screenText(rawText, schoolDomain) {
  if (!rawText) return { findings: [] };
  const { normalized, collapsed } = normalizeForAnalysis(rawText);
  const findings = [];

  if (profanity.exists(normalized) || profanity.exists(collapsed)) {
    findings.push({
      category: 'profanity',
      severity: BUILTIN_PROFANITY_SEVERITY,
      source: 'lexical',
      confidence: null,
      rationale: '@2toad/profanity built-in dictionary match',
    });
  }

  const terms = await loadTerms();
  const allowlisted = new Set(
    terms.filter(t => t.is_allowlist && (t.school_domain === null || t.school_domain === schoolDomain))
      .map(t => t.term.toLowerCase())
  );

  for (const t of terms) {
    if (t.is_allowlist) continue;
    if (t.school_domain && t.school_domain !== schoolDomain) continue; // FNE-wide terms have school_domain NULL and always apply
    const termLower = t.term.toLowerCase();
    if (allowlisted.has(termLower)) continue;
    if (wholeWordMatch(normalized, termLower) || collapsed.includes(termLower.replace(/[\s\-_.,'"]+/g, ''))) {
      findings.push({
        category: t.category,
        severity: t.severity,
        source: 'lexical',
        confidence: null,
        rationale: `Matched configured term (scope: ${t.school_domain ? 'school' : 'fne'})`,
      });
    }
  }

  return { findings };
}

module.exports = { screenText, loadTerms };
