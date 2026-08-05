require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const pool = require('../db/pool');

(async () => {
  const conn = await pool.getConnection();
  try {
    // license_products: add addon_rate_cents
    const [lpcols] = await conn.query("SHOW COLUMNS FROM license_products LIKE 'addon_rate_cents'");
    if (!lpcols.length) {
      await conn.query('ALTER TABLE license_products ADD COLUMN addon_rate_cents INT UNSIGNED NULL');
      console.log('license_products: added addon_rate_cents');
    } else {
      console.log('license_products: addon_rate_cents already exists, skipping');
    }

    // quote_requests: add 4 breakdown columns
    const breakdown = [
      ['quoted_tier_name',       "ALTER TABLE quote_requests ADD COLUMN quoted_tier_name VARCHAR(100) NULL"],
      ['quoted_addon_seats',     "ALTER TABLE quote_requests ADD COLUMN quoted_addon_seats TINYINT UNSIGNED NULL"],
      ['quoted_proration_factor',"ALTER TABLE quote_requests ADD COLUMN quoted_proration_factor DECIMAL(3,2) NULL"],
      ['quoted_term_years',      "ALTER TABLE quote_requests ADD COLUMN quoted_term_years TINYINT UNSIGNED NULL"],
    ];
    for (const [col, sql] of breakdown) {
      const [rows] = await conn.query(`SHOW COLUMNS FROM quote_requests LIKE '${col}'`);
      if (!rows.length) {
        await conn.query(sql);
        console.log(`quote_requests: added ${col}`);
      } else {
        console.log(`quote_requests: ${col} already exists, skipping`);
      }
    }

    console.log('Done.');
    process.exit(0);
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    conn.release();
  }
})();
