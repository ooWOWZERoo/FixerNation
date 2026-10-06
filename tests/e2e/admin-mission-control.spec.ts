/** Isolated visual-shell regression tests. No production API requests are sent. */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(__dirname, '../..');
const pages = fs.readdirSync(root).filter(file => /^admin-.*\.html$/.test(file));
const workspaces = pages.filter(file => fs.readFileSync(path.join(root, file), 'utf8').includes('src="admin-nav.js'));
const mime: Record<string, string> = { '.html':'text/html', '.js':'application/javascript', '.css':'text/css', '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
test.beforeEach(async ({ page }) => {
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'fne-preview.test') return route.abort();
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/auth/me') return route.fulfill({json:{loggedIn:true, username:'Preview admin'}});
      return route.fulfill({status:503, json:{error:'Isolated preview: API unavailable'}});
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({status:404,body:'Not found'});
    return route.fulfill({contentType:mime[path.extname(file)] || 'application/octet-stream',body:fs.readFileSync(file)});
  });
});
for (const file of pages) {
  test(file + ' has a responsive presentation', async ({page}) => {
    await page.setViewportSize({width:1440,height:1000});
    await page.goto('http://fne-preview.test/' + file);
    await expect(page.locator('body')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (workspaces.includes(file)) {
      await expect(page.locator('.mc-hero')).toHaveCount(1);
      await expect(page.locator('.a-sidebar a[aria-current]')).toHaveCount(1);
      const before = await page.locator('html').getAttribute('data-theme');
      await page.getByLabel('Toggle light and dark theme').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme',before === 'dark' ? 'light' : 'dark');
    }
    await page.setViewportSize({width:390,height:844});
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    if (workspaces.includes(file)) {
      await page.getByRole('button',{name:'Open navigation',exact:true}).click();
      await expect(page.locator('.mc-nav-close')).toBeFocused();
      await page.keyboard.press('Shift+Tab');
      expect(await page.evaluate(() => !!document.activeElement?.closest('.a-sidebar'))).toBe(true);
      await page.keyboard.press('Escape');
      await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toBeFocused();
      await expect(page.getByRole('button',{name:'Open navigation',exact:true})).toHaveAttribute('aria-expanded','false');
    }
  });
}
test('page finder navigates using the keyboard',async({page})=>{
  await page.goto('http://fne-preview.test/admin-dashboard.html');
  const finder=page.getByLabel('Find an admin page',{exact:true});
  await finder.fill('invoi');await finder.press('ArrowDown');
  await expect(page.locator('#mc-page-results a')).toBeFocused();
  await page.keyboard.press('Enter');await expect(page).toHaveURL(/admin-invoices\.html$/);
});
test('curriculum editor still opens and cancels',async({page})=>{
  await page.goto('http://fne-preview.test/admin-curriculum.html');
  await page.getByRole('button',{name:'+ Build New Curriculum',exact:true}).click();
  await expect(page.locator('#curriculumModalOverlay')).toBeVisible();
  await page.locator('#curriculumModalOverlay .a-modal-close').click();
  await expect(page.locator('#curriculumModalOverlay')).toBeHidden();
});
