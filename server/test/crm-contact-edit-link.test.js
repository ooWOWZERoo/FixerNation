// The Customer Hub contact page links to the older CRM page's Edit Contact box, where a person's State (and name, company, phone, address) is changed. Run:  cd server && npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

test('THE LINK: the contact page links to admin-newsletter.html?edit=<id> for staff who can write, and says where it goes', () => {
  const page = read('admin-crm-contact.html');
  assert.match(page, /C\.can\('write'\) \? '<p class="crm-small"[^']*<a class="crm-link" href="admin-newsletter\.html\?edit=' \+ encodeURIComponent\(c\.id\) \+ '">Edit name, company, state, phone and address/);
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});

test('THE ARRIVAL: the CRM page opens the Edit Contact box for ?edit=<id> once the contacts are loaded, only for a whole-number id that is in the list', () => {
  const page = read('admin-newsletter.html');
  assert.match(page, /fetchAndRenderContacts\(\)\.then\(function \(\) \{\s*const want = Number\(new URLSearchParams\(window\.location\.search\)\.get\('edit'\)\);\s*if \(Number\.isInteger\(want\) && want > 0 && contactsCache\.some\(function \(x\) \{ return x\.id === want; \}\)\) editContact\(want\);/);
  assert.doesNotThrow(() => new (require('node:vm').Script)([...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()[1]));
});
