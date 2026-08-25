// Local, in-process image nudity/skin-exposure screening via nsfwjs, running
// on @tensorflow/tfjs-node (server-side inference, no browser dependency, no
// separate service). Zero cost, zero third-party data sharing — this is the
// "image nudity/skin-exposure risk" layer from the implementation plan §1.1
// step 4. It does NOT cover violence/gore/self-harm imagery (spec media
// taxonomy) — that gap is only closed once the optional OpenAI contextual
// layer is enabled (lib/safety/contextual.js).
//
// Deliberately outputs ONLY risk scores (nudityRisk/explicitRegionRisk-style
// numbers), never any identity/demographic field — spec §18.1 prohibits
// inferring race/ethnicity from an image, and nsfwjs's model has no such
// output to begin with.

let tf = null;
let nsfwjs = null;
let modelPromise = null;

function getModel() {
  if (!modelPromise) {
    tf = tf || require('@tensorflow/tfjs-node');
    nsfwjs = nsfwjs || require('nsfwjs');
    modelPromise = nsfwjs.load();
  }
  return modelPromise;
}

// Maps nsfwjs's 5 classes down to the two spec-relevant risk scores. Severity
// bucketing from these scores happens in policy.js via the admin-configurable
// safety_rules table, NOT here — this function only reports what the model
// actually measured.
async function classifyImageBuffer(buffer) {
  const model = await getModel();
  const image = tf.node.decodeImage(buffer, 3);
  try {
    const predictions = await model.classify(image);
    const scores = {};
    for (const p of predictions) scores[p.className] = p.probability;
    return {
      nudityRisk: Math.max(scores.Porn || 0, scores.Sexy || 0),
      explicitRegionRisk: scores.Porn || 0,
      hentaiRisk: scores.Hentai || 0,
      raw: scores,
    };
  } finally {
    image.dispose();
  }
}

module.exports = { classifyImageBuffer };
