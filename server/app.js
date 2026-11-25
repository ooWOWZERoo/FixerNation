const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
require('express-async-errors');
const cookieParser = require('cookie-parser');

const authRoutes = require('./routes/auth');
const bookRoutes = require('./routes/books');
const uploadRoutes = require('./routes/uploads');
const curriculumRoutes = require('./routes/curriculum');
const blogRoutes = require('./routes/blog');
const blogFavoritesRoutes = require('./routes/blog-favorites');
const favoritesRoutes = require('./routes/favorites');
const newsletterRoutes = require('./routes/newsletter');
const { router: campaignRoutes } = require('./routes/campaigns');
const siteAuthRoutes = require('./routes/site-auth');
const checkoutRoutes = require('./routes/checkout');
const licenseProductRoutes = require('./routes/license-products');
const invoiceRoutes = require('./routes/invoices');
const contactRoutes = require('./routes/contact');
const supportRoutes = require('./routes/support');
const adminSupportRoutes = require('./routes/admin-support');
const adminSupportConsoleRoutes = require('./routes/admin-support-console');
const clientErrorRoutes = require('./routes/client-errors');
const adminClientErrorRoutes = require('./routes/admin-client-errors');
const helpCenterRoutes = require('./routes/help-center');
const adminHelpAnswerRoutes = require('./routes/admin-help-answers');
const adminErrorAlertRoutes = require('./routes/admin-error-alerts');
const adminViewAsRoutes = require('./routes/admin-view-as');
const viewAsRoutes = require('./routes/view-as');
const { viewAsGate } = require('./lib/view-as');
const { recordServerError } = require('./lib/client-errors');
const { sharedDemoGate } = require('./lib/public-demo');
const dashboardRoutes = require('./routes/dashboard');
const analyticsRoutes = require('./routes/analytics');
const settingsRoutes = require('./routes/settings');
const automationRoutes = require('./routes/automations');
const morningBoostModule = require('./routes/morning-boost');
const schoolRegistrationRoutes = require('./routes/school-registration');
const socialRoutes = require('./routes/social');
const schoolAdminRoutes = require('./routes/school-admin');
const schoolInviteRoutes = require('./routes/school-invite');
const parentInviteRoutes = require('./routes/parent-invite');
const adminSchoolAdminsRoutes = require('./routes/admin-school-admins');
const districtAdminRoutes = require('./routes/district-admin');
const adminDistrictsRoutes = require('./routes/admin-districts');
const adminConciergeRoutes = require('./routes/admin-concierge');
const adminPublicDemoRoutes = require('./routes/admin-public-demo');
const publicDemoRoutes = require('./routes/public-demo');
const brainGamesRoutes = require('./routes/brain-games');
const learningEventsRoutes = require('./routes/learning-events');
const classroomAuthRoutes = require('./routes/classroom-auth');
const classroomsRoutes = require('./routes/classrooms');
const studentRoutes = require('./routes/student');
const studentPortraitRoutes = require('./routes/student-portrait');
const parentRoutes = require('./routes/parent');
const parentPortraitRoutes = require('./routes/parent-portrait');
const programReportRoutes = require('./routes/program-report');
const teacherLessonPlansRoutes = require('./routes/teacher-lesson-plans');
const adminTeacherLessonPlansRoutes = require('./routes/admin-teacher-lesson-plans');
const quoteAcceptRoutes = require('./routes/quote-accept');
const contentSafetyRoutes = require('./routes/content-safety');
const adminAccountLookupRoutes = require('./routes/admin-account-lookup');
const affiliateRoutes = require('./routes/affiliates');
const affiliatePortalRoutes = require('./routes/affiliate-portal');
const standardsRoutes = require('./routes/standards');
const pogEvidenceRoutes = require('./routes/pog-evidence');
const adminStandardsRoutes = require('./routes/admin-standards');
const districtAdminStandardsRoutes = require('./routes/district-admin-standards');
const districtAdminRepeatRoutes = require('./routes/district-admin-repeat');
const crmSettingsRoutes = require('./routes/crm-settings');
const crmAccountsRoutes = require('./routes/crm-accounts');
const crmContactsRoutes = require('./routes/crm-contacts');
const crmOpportunitiesRoutes = require('./routes/crm-opportunities');
const crmQuotesRoutes = require('./routes/crm-quotes');
const crmOverviewRoutes = require('./routes/crm-overview');
const crmReportsRoutes = require('./routes/crm-reports');
const crmTasksRoutes = require('./routes/crm-tasks');
const crmNotesRoutes = require('./routes/crm-notes');
const crmFilesRoutes = require('./routes/crm-files');
const crmMeetingsRoutes = require('./routes/crm-meetings');
const crmChecklistsRoutes = require('./routes/crm-checklists');
const crmRefundsRoutes = require('./routes/crm-refunds');
const crmAttentionRoutes = require('./routes/crm-attention');
const crmTimelineRoutes = require('./routes/crm-timeline');
const crmAuditRoutes = require('./routes/crm-audit');

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set — check that server/.env exists and is being loaded.');
}

const app = express();

// Don't advertise the framework/version to anyone fingerprinting the API.
app.disable('x-powered-by');

// Stripe's webhook signature check needs the raw, unparsed request body, so
// this must be registered before the global JSON body parser below (which
// would otherwise consume the stream and leave nothing for Stripe to verify).
app.post('/api/checkout/webhook', express.raw({ type: 'application/json' }), checkoutRoutes.webhookHandler);

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());
// Staff "view as" tabs send X-View-As; the gate checks it, keeps the view read-only and on a short list of routes, and supplies the person's identity.
// Must come before the demo gate and every route: lib/view-as.js.
app.use('/api', viewAsGate());
// Shared demo sessions end when the demo closes, and run with restrictions (no outside email, downloads or uploads) while it is open.
// Must come before every route: lib/public-demo.js.
app.use('/api', sharedDemoGate);
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store, private'); next(); });

// Defense-in-depth against cross-site request forgery. Session cookies are
// SameSite=Lax and the JSON body parser only accepts application/json (which a
// cross-site page can't send without a CORS preflight this API never grants),
// so forged writes are already blocked -- but SameSite is *same-site*, not
// same-origin, so a compromised sibling subdomain would slip past it. Modern
// browsers label every request with Sec-Fetch-Site / Origin; reject any write
// that says it came from somewhere else. Requests with neither header
// (curl, server-to-server) are untouched, and the Stripe webhook is exempt
// since it authenticates by signature instead.
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  if (req.path === '/checkout/webhook') return next();
  const fetchSite = req.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    return res.status(403).json({ error: 'Cross-site request blocked' });
  }
  const origin = req.get('Origin');
  if (origin) {
    let originHost = null;
    try { originHost = new URL(origin).host; } catch { /* malformed Origin is rejected below */ }
    if (!originHost || originHost !== req.get('Host')) {
      return res.status(403).json({ error: 'Cross-site request blocked' });
    }
  }
  next();
});

app.use('/api/auth', authRoutes.router);
app.use('/api/books', bookRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/curricula', curriculumRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/blog-favorites', blogFavoritesRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/newsletter', newsletterRoutes.router);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/site-auth', siteAuthRoutes.router);
app.use('/api/checkout', checkoutRoutes.router);
app.use('/api/license-products', licenseProductRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/contact', contactRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/admin/support', adminSupportRoutes);
app.use('/api/admin/support-console', adminSupportConsoleRoutes);
app.use('/api/client-errors', clientErrorRoutes);
app.use('/api/admin/client-errors', adminClientErrorRoutes);
app.use('/api/help-center', helpCenterRoutes);
app.use('/api/admin/help-answers', adminHelpAnswerRoutes);
app.use('/api/admin/error-alerts', adminErrorAlertRoutes);
app.use('/api/admin/view-as', adminViewAsRoutes);
app.use('/api/view-as', viewAsRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/automations', automationRoutes);
app.use('/api/morning-boost', morningBoostModule.router);
app.use('/api/school-registration', schoolRegistrationRoutes);
app.use('/api/social', socialRoutes);
app.use('/api/school-admin', schoolAdminRoutes);
app.use('/api/school-invite', schoolInviteRoutes);
app.use('/api/parent-invite', parentInviteRoutes);
app.use('/api/admin/school-admins', adminSchoolAdminsRoutes);
// Mounted before the general district-admin router so /standards is never shadowed by it.
app.use('/api/district-admin/standards', districtAdminStandardsRoutes);
// G5: reorder and seat-change requests. Also before the general router, for the same reason.
app.use('/api/district-admin/repeat', districtAdminRepeatRoutes);
app.use('/api/district-admin', districtAdminRoutes);
app.use('/api/admin/districts', adminDistrictsRoutes);
app.use('/api/admin/concierge', adminConciergeRoutes);
app.use('/api/admin/public-demo', adminPublicDemoRoutes);
app.use('/api/demo', publicDemoRoutes);
app.use('/api/brain-games', brainGamesRoutes);
app.use('/api/learning-events', learningEventsRoutes);
app.use('/api/classroom-auth', classroomAuthRoutes.router);
app.use('/api/classrooms', classroomsRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/student-portrait', studentPortraitRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/parent-portrait', parentPortraitRoutes);
app.use('/api/program-report', programReportRoutes);
app.use('/api/teacher/lesson-plans', teacherLessonPlansRoutes);
app.use('/api/admin/teacher-lesson-plans', adminTeacherLessonPlansRoutes);
app.use('/api/quotes', quoteAcceptRoutes.router);
app.use('/api/content-safety', contentSafetyRoutes);
app.use('/api/admin/account-lookup', adminAccountLookupRoutes);
app.use('/api/affiliates', affiliateRoutes);
app.use('/api/affiliate-portal', affiliatePortalRoutes);
app.use('/api/standards', standardsRoutes);
app.use('/api/graduate-evidence', pogEvidenceRoutes);
app.use('/api/admin/standards', adminStandardsRoutes);
// Sales CRM (docs/reference/sales-crm-update-requirements.md). Dark until the setting crm_v2_enabled is 'true': every route answers 404 before that.
app.use('/api/crm/accounts', crmAccountsRoutes);
app.use('/api/crm/contacts', crmContactsRoutes);
app.use('/api/crm/opportunities', crmOpportunitiesRoutes);
app.use('/api/crm/quotes', crmQuotesRoutes);
app.use('/api/crm/overview', crmOverviewRoutes);
app.use('/api/crm/reports', crmReportsRoutes);
app.use('/api/crm/tasks', crmTasksRoutes);
app.use('/api/crm/notes', crmNotesRoutes);
app.use('/api/crm/files', crmFilesRoutes);
app.use('/api/crm/meetings', crmMeetingsRoutes);
app.use('/api/crm/checklists', crmChecklistsRoutes);
app.use('/api/crm/refunds', crmRefundsRoutes);
app.use('/api/crm/repeat-requests', require('./routes/crm-repeat-requests'));
app.use('/api/crm/customers', require('./routes/crm-customers'));
app.use('/api/crm/import', require('./routes/crm-import'));
app.use('/api/crm/attention', crmAttentionRoutes);
app.use('/api/crm/timeline', crmTimelineRoutes);
app.use('/api/crm/audit', crmAuditRoutes);
app.use('/api/crm', crmSettingsRoutes);
// The merged Contacts screen (docs/reference/contact-pages-merge-requirements.md): keeps working with the Hub switched off (requireCrmRole, not requireCrm), so it is NOT a crm-* file.
app.use('/api/admin/contacts', require('./routes/contact-screens'));

// Always serve uploaded files at /uploads/ from wherever UPLOADS_DIR points.
// In production LiteSpeed checks public_html/uploads/ first; if the file isn't
// there (because UPLOADS_DIR still points to server/uploads/) it falls through
// to Node, which handles it here.
const uploadsPath = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
// Sales CRM files live in uploads/crm-private and are NEVER a public URL: they are read only through GET /api/crm/files/:id/download (lib/crm-files.js).
// This answers first, so express.static below can never serve them; .htaccess refuses the same path for the web server's own static handling.
app.use('/uploads/crm-private', (req, res) => res.status(404).type('text/plain').send('Not found'));
// Punch list S9: the line above only matches the path as typed, so an encoded spelling (/uploads/%63rm-private/...) or a different case would skip it. This one judges the
// decoded, normalized path before express.static sees it.
app.use('/uploads', (req, res, next) => (require('./lib/crm-files').isPrivatePath(req.path) ? res.status(404).type('text/plain').send('Not found') : next()));
app.use('/uploads', express.static(uploadsPath));

// In development, also serve the static site from the repo root so the whole
// site can be exercised at one URL. In production, LiteSpeed serves those files
// directly from public_html and this app only ever handles /api/*.
if (process.env.SERVE_STATIC === 'true') {
  const siteRoot = path.join(__dirname, '..');
  app.use(express.static(siteRoot));
}

app.use((err, req, res, next) => {
  console.error(err);
  recordServerError(req, err); // so staff can see it in the Support Inbox (Errors tab); never throws
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Fixer Nation server listening on http://localhost:${port}`);
});
