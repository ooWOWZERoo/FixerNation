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

// Two host-specific compatibility fixes, applied once, before tfjs-node is
// ever required — confirmed necessary via a live diagnostic session on this
// project's actual cPanel/CloudLinux host (see CONTENT_SAFETY_IMPLEMENTATION_PLAN.md):
//
// 1. TensorFlow's native runtime sizes its thread pool off the HOST's real
//    CPU count (32 cores here), not this account's actual CloudLinux LVE
//    process/thread cap — which is enforced invisibly (ulimit/proc/self/limits
//    both report "unlimited"). Left unbounded, pthread_create() hits EAGAIN
//    and the entire Node process aborts with SIGABRT — a native crash no JS
//    try/catch can contain. Forcing every thread-pool knob TF/oneDNN reads
//    down to 1 keeps it well under the invisible cap.
// 2. This @tensorflow/tfjs-node build's core op-dispatch path
//    (nodejs_kernel_backend.js, used by nearly every op including the TopK
//    call nsfwjs's classify() makes) still calls Node's util.isNullOrUndefined,
//    removed from Node itself years ago. The function is pure and its old
//    behavior is one line, so polyfilling it is a safe, targeted shim rather
//    than patching a third-party package.
function applyHostCompatibilityFixes() {
  process.env.TF_NUM_INTEROP_THREADS = process.env.TF_NUM_INTEROP_THREADS || '1';
  process.env.TF_NUM_INTRAOP_THREADS = process.env.TF_NUM_INTRAOP_THREADS || '1';
  process.env.OMP_NUM_THREADS = process.env.OMP_NUM_THREADS || '1';
  process.env.DNNL_NUM_THREADS = process.env.DNNL_NUM_THREADS || '1';

  const util = require('util');
  if (typeof util.isNullOrUndefined !== 'function') {
    util.isNullOrUndefined = (v) => v === null || v === undefined;
  }
}

function getModel() {
  if (!modelPromise) {
    applyHostCompatibilityFixes();
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
