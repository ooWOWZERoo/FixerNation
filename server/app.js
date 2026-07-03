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

if (!process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET is not set — check that server/.env exists and is being loaded.');
}

const app = express();

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
