// Sales CRM Customers & Renewals screen (punch list G11, mounted at /api/crm/customers). Read only: renewals coming up with plain reasons, the expansion pipeline and onboarding progress.
// Every CRM role may read it (the same view rule as the Overview). Nothing here writes. lib/crm-customers.js has the rules.
const express = require('express');
const pool = require('../db/pool');
const { requireAuth } = require('../middleware/auth');
const { requireCrm } = require('../lib/crm-permissions');
const { sqlNow } = require('../lib/crm-classification');
const customers = require('../lib/crm-customers');

const router = express.Router();

router.get('/', requireAuth, requireCrm('view'), async (req, res) => {
  const now = sqlNow();
  res.json(await customers.build(pool, { today: now.slice(0, 10), now }));
});

module.exports = router;
