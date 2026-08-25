// Provider-abstracted contextual/semantic moderation layer (spec FR-045 —
// "third-party moderation shall be integrated through replaceable provider
// abstractions"). Ships OFF by default; only runs when BOTH the admin flag
// (settings key content_safety_openai_enabled) is 'true' AND OPENAI_API_KEY
// is configured in server/.env — same "coded but not live until configured"
// pattern already used for ELEVENLABS_API_KEY/STRIPE_SECRET_KEY.
//
// This layer exists to catch what the local lexical/image layers structurally
// cannot: mean-without-profanity, hate/bias, threats, self-harm, sexual
// harassment in text, and violence/gore in images. Swapping to a different
// provider later means adding a new *Provider function here and switching
// which one runVia() calls — not touching gateway.js or any call site.

const { getSetting } = require('../settings');

async function isEnabled() {
  const flag = await getSetting('content_safety_openai_enabled');
  return flag === 'true' && !!process.env.OPENAI_API_KEY;
}

// Always-allow stub — the default when the flag is off or no key is set.
async function nullProvider() {
  return { findings: [] };
}

// OpenAI omni-moderation — free endpoint, text + image in one call.
async function openAiProvider({ text, images }) {
  const OpenAI = require('openai');
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const input = [];
  if (text) input.push({ type: 'text', text });
  for (const img of images || []) {
    input.push({ type: 'image_url', image_url: { url: `data:${img.mimetype};base64,${img.buffer.toString('base64')}` } });
  }
  if (!input.length) return { findings: [] };

  const result = await client.moderations.create({ model: 'omni-moderation-latest', input });
  const r = result.results && result.results[0];
  if (!r || !r.flagged) return { findings: [] };

  const findings = Object.entries(r.categories)
    .filter(([, flagged]) => flagged)
    .map(([category]) => ({
      category: `openai_${category}`, // namespaced so it can't collide with FNE's own taxonomy category strings
      confidence: (r.category_scores && r.category_scores[category]) || null,
      source: 'contextual',
      rationale: `OpenAI omni-moderation flagged category "${category}"`,
    }));

  return { findings };
}

async function runContextualCheck({ text, images }) {
  if (!(await isEnabled())) return { findings: [], provider: 'null' };
  try {
    const result = await openAiProvider({ text, images });
    return { ...result, provider: 'openai' };
  } catch (err) {
    // Fail closed for the caller to decide — this layer itself never throws
    // past this point, but signals unavailability so gateway.js can apply
    // the spec's fail-closed rule (§5) for mandatory publication paths.
    return { findings: [], provider: 'openai', error: err.message };
  }
}

module.exports = { runContextualCheck, isEnabled, nullProvider, openAiProvider };
