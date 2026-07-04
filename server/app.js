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
const campaignRoutes = require('./routes/campaigns');
const siteAuthRoutes = require('./routes/site-auth');
const checkoutRoutes = require('./routes/checkout');
const licenseProductRoutes = require('./routes/license-products');
const invoiceRoutes = require('./routes/invoices');
const contactRoutes = require('./routes/contact');
const dashboardRoutes = require('./routes/dashboard');

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set — check that server/.env exists and is being loaded.');
}

const app = express();

// Stripe's webhook signature check needs the raw, unparsed request body, so
// this must be registered before the global JSON body parser below (which
// would otherwise consume the stream and leave nothing for Stripe to verify).
app.post('/api/checkout/webhook', express.raw({ type: 'application/json' }), checkoutRoutes.webhookHandler);

app.use(express.json({ limit: '5mb' }));
app.use(cookieParser());

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

// In development, also serve the static site from the repo root so the whole
// site can be exercised at one URL. In production, Apache serves those files
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
