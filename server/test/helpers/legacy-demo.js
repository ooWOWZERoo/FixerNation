// Test helper: builds the ORIGINAL single shared demo's rows (district "FNE Demo District", school public-demo.example.com, demo-teacher@public-demo.example.com ...)
// the way the retired seed used to, so tests can prove that a demo of the 'public' kind (a leftover in production until scripts/retire-original-demo.js has been
// run) is still confined, and that the retire script removes exactly it. The seed library now refuses a fixture set with no workspace, so this seeds the
// legacy names as a throwaway workspace number and then strips the workspace markers off, which leaves exactly what the original seed produced.
const path = require('node:path');
const SERVER = path.join(__dirname, '..', '..');
const seedLib = require(path.join(SERVER, 'scripts/seed-public-demo.js'));
const { legacyFixtures } = require(path.join(SERVER, 'lib/public-demo-workspaces.js'));

const THROWAWAY = 99;

async function seedLegacy(conn, { password = 'demo-shared-test-password-1', pin = '482915', rounds = 4 } = {}) {
  const fx = { ...legacyFixtures(), number: THROWAWAY };
  const out = await seedLib.seed(conn, { password, pin, rounds, fx }, seedLib.makeReport());
  await conn.query('UPDATE site_users SET demo_workspace_id = NULL WHERE demo_workspace_id = ?', [THROWAWAY]);
  await conn.query('DELETE FROM public_demo_workspaces WHERE id = ?', [THROWAWAY]);
  return out;
}

module.exports = { seedLegacy };
