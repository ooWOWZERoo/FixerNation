// Sales CRM prospect import (punch list G22, mounted at /api/crm/import). People arrive as rows parsed in the browser from a CSV; the server plans and writes them (lib/crm-import.js).
// Who may do what: everyone with a CRM role can read the review queue and the import history; CRM Admin and Sales can preview, import and decide a queued row (the same people who can
// add a person by hand); Read-only never. Imports are Suspects, not subscribed to the newsletter, and nothing is ever merged or overwritten.
const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const H = require('../lib/crm-import-http'); // the handlers, shared with the merged Contacts screen (routes/contact-screens.js)

const router = express.Router();

// What an import WOULD do, row by row. Writes nothing. The handlers (and the rules for each) are in lib/crm-import-http.js and lib/crm-import.js.
router.post('/preview', requireAuth, requireCrm('write'), H.preview);
router.post('/run', requireAuth, requireCrm('write'), H.run);
// ?state=waiting (default)|same_person|different_person|skipped
router.get('/review', requireAuth, requireCrm('view'), H.review);
router.post('/review/:id/resolve', requireAuth, requireCrm('write'), H.resolve);
// The last 20 imports and what each did (counts only).
router.get('/batches', requireAuth, requireCrm('view'), H.batches);
// Undo an import: CRM Admin only, a preview first, once.
router.post('/batches/:id/undo-preview', requireAuth, requireCrm('erase'), H.undoPreview);
router.post('/batches/:id/undo', requireAuth, requireCrm('erase'), H.undo);

module.exports = router;
