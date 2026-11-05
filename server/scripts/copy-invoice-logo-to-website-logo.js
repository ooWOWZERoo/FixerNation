require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

// Starting point for the website logo setting: copies the invoice branding logo (settings.invoice_logo_url) into
// settings.website_logo_url, once. Idempotent: skips if website_logo_url already has a row, or if there is no invoice logo.
// After this the two settings are independent. Safe to run before or after the Node app restart (the app treats a missing
// website_logo_url as "use the built-in logo").
async function main() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const [[existing]] = await connection.query("SELECT setting_value FROM settings WHERE setting_key = 'website_logo_url' LIMIT 1");
  if (existing) { console.log(`Skipped: website_logo_url already set (${existing.setting_value || 'empty'}).`); await connection.end(); return; }
  const [[invoice]] = await connection.query("SELECT setting_value FROM settings WHERE setting_key = 'invoice_logo_url' LIMIT 1");
  const value = invoice && invoice.setting_value ? invoice.setting_value : '';
  if (!value) { console.log('Skipped: no invoice logo is set, so the website keeps the built-in logo.'); await connection.end(); return; }
  await connection.query("INSERT INTO settings (setting_key, setting_value) VALUES ('website_logo_url', ?)", [value]);
  console.log(`Copied the invoice logo to website_logo_url: ${value}`);
  await connection.end();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
