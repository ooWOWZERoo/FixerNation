// Text normalization for ANALYSIS ONLY — the caller must keep the original,
// unmodified text for storage/evidence (spec FR-006: normalization must not
// destroy original content). This collapses common evasion techniques so
// the lexical filter isn't trivially bypassed by spacing/casing/unicode
// tricks, without attempting to be a full anti-evasion system.

const LEET_MAP = { '4': 'a', '@': 'a', '8': 'b', '3': 'e', '6': 'g', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't', '+': 't' };

function normalizeForAnalysis(text) {
  if (!text) return '';
  let s = String(text);

  // Unicode compatibility normalization (accents, full-width chars, etc.)
  s = s.normalize('NFKC');

  // Strip zero-width and other invisible formatting characters used to
  // split a blocked word across "invisible" boundaries.
  s = s.replace(/[​-‏‪-‮﻿]/g, '');

  s = s.toLowerCase();

  // Common leetspeak/symbol substitutions.
  s = s.replace(/[4@836150!$7+]/g, ch => LEET_MAP[ch] || ch);

  // Remove punctuation/spacing/hyphens/underscores inserted between letters
  // (e.g. "b-a-d w o r d") while leaving normal word boundaries alone for the
  // whole-word matching @2toad/profanity does downstream — this is a
  // *separate* tightly-collapsed string used only to catch that specific
  // evasion pattern, not a replacement for the normal-spaced string.
  const collapsed = s.replace(/[\s\-_.,'"*]+/g, '');

  // Collapse repeated characters (e.g. "baaaad" -> "bad") for both variants.
  const dedupe = str => str.replace(/(.)\1{2,}/g, '$1$1');

  return {
    normalized: dedupe(s),
    collapsed: dedupe(collapsed),
  };
}

module.exports = { normalizeForAnalysis };
