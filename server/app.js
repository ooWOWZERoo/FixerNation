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
const newsletterRoutes = require('./routes/newsletter');
const { router: campaignRoutes } = require('./routes/campaigns');
const siteAuthRoutes = require('./routes/site-auth');
const checkoutRoutes = require('./routes/checkout');
const licenseProductRoutes = require('./routes/license-products');
const invoiceRoutes = require('./routes/invoices');
const contactRoutes = require('./routes/contact');
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
const brainGamesRoutes = require('./routes/brain-games');
const learningEventsRoutes = require('./routes/learning-events');
const classroomAuthRoutes = require('./routes/classroom-auth');
const classroomsRoutes = require('./routes/classrooms');
const studentRoutes = require('./routes/student');
const parentRoutes = require('./routes/parent');
const teacherLessonPlansRoutes = require('./routes/teacher-lesson-plans');
const adminTeacherLessonPlansRoutes = require('./routes/admin-teacher-lesson-plans');
const quoteAcceptRoutes = require('./routes/quote-accept');
const contentSafetyRoutes = require('./routes/content-safety');
const adminAccountLookupRoutes = require('./routes/admin-account-lookup');
const affiliateRoutes = require('./routes/affiliates');
const affiliatePortalRoutes = require('./routes/affiliate-portal');
const standardsRoutes = require('./routes/standards');
const adminStandardsRoutes = require('./routes/admin-standards');

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
app.use('/api/newsletter', newsletterRoutes.router);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/site-auth', siteAuthRoutes.router);
app.use('/api/checkout', checkoutRoutes.router);
app.use('/api/license-products', licenseProductRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/contact', contactRoutes);
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
app.use('/api/district-admin', districtAdminRoutes);
app.use('/api/admin/districts', adminDistrictsRoutes);
app.use('/api/admin/concierge', adminConciergeRoutes);
app.use('/api/brain-games', brainGamesRoutes);
app.use('/api/learning-events', learningEventsRoutes);
app.use('/api/classroom-auth', classroomAuthRoutes.router);
app.use('/api/classrooms', classroomsRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/parent', parentRoutes);
app.use('/api/teacher/lesson-plans', teacherLessonPlansRoutes);
app.use('/api/admin/teacher-lesson-plans', adminTeacherLessonPlansRoutes);
app.use('/api/quotes', quoteAcceptRoutes.router);
app.use('/api/content-safety', contentSafetyRoutes);
app.use('/api/admin/account-lookup', adminAccountLookupRoutes);
app.use('/api/affiliates', affiliateRoutes);
app.use('/api/affiliate-portal', affiliatePortalRoutes);
app.use('/api/standards', standardsRoutes);
app.use('/api/admin/standards', adminStandardsRoutes);

// Always serve uploaded files at /uploads/ from wherever UPLOADS_DIR points.
// In production LiteSpeed checks public_html/uploads/ first; if the file isn't
// there (because UPLOADS_DIR still points to server/uploads/) it falls through
// to Node, which handles it here.
const uploadsPath = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
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
  res.status(500).json({ error: 'Internal server error' });
});

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(`Fixer Nation server listening on http://localhost:${port}`);
});
