// C2  Set district-wide branding. Signed in as the demo district administrator of Riverbend School District.
// The logo is a made-up "Riverbend" mark drawn off-camera (a 600 x 200 transparent PNG), never a real district's logo.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const LOGO = path.join(__dirname, "..", "..", "howto-out", "C2", "riverbend-logo.png");

async function drawLogo() {
  fs.mkdirSync(path.dirname(LOGO), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 600, height: 200 } });
  await page.setContent(`<body style="margin:0;background:transparent;font-family:Georgia,serif">
    <div style="display:flex;align-items:center;justify-content:center;height:200px;gap:18px">
      <svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="#1d6b4f"/><path d="M48 18 58 36 78 38 63 52 68 72 48 62 28 72 33 52 18 38 38 36Z" fill="#f2b84b"/></svg>
      <div><div style="font-size:40px;font-weight:700;color:#1d6b4f;line-height:1">Riverbend</div><div style="font-size:24px;color:#555;letter-spacing:3px">SCHOOL DISTRICT</div></div>
    </div></body>`);
  await page.screenshot({ path: LOGO, omitBackground: true });
  await b.close();
}

const typeHex = async (p: import("@playwright/test").Page, id: string, hex: string) => {
  await glideClick(p, id);
  await p.keyboard.press("Meta+a");
  await p.keyboard.type(hex, { delay: 80 });
};

const board: Storyboard = {
  slug: "C2",
  title: "Set district-wide branding",
  as: "district-admin",
  startPath: "/district-admin-dashboard.html",
  setup: drawLogo,
  steps: [
    {
      say: "In this video you'll set the logo and colors that every school in your district starts with.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="district-admin-branding.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#pageContent", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Here's how it works. Whatever you publish here becomes the default look for each school in your district that hasn't published its own branding. If a school has its own, the school's look always wins.",
      run: (p) => glideTo(p, "#brandDistrictName"),
    },
    {
      say: "Select Upload Logo. Use a P-N-G, J-P-G, WebP, or S-V-G file under two megabytes, at least two hundred pixels wide and one hundred tall. A transparent P-N-G works best.",
      run: async (p) => {
        const chooser = p.waitForEvent("filechooser");
        await glideClick(p, 'button:has-text("Upload Logo")');
        await (await chooser).setFiles(LOGO);
        await p.waitForSelector("#logoPreviewBox img");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "Then select Edit Crop to trim it to fit. Drag the box to move it, or drag the corner to resize it, and select Apply Crop. Cropping never changes your original file.",
      run: async (p) => {
        await glideClick(p, "#editCropBtn");
        await p.waitForSelector("#lcwStage", { state: "visible" });
        await p.waitForTimeout(3500);
        const h = await p.locator("#lcwHandle").boundingBox();
        if (h) {
          await p.mouse.move(h.x + h.width / 2, h.y + h.height / 2, { steps: 15 });
          await p.mouse.down();
          await p.mouse.move(h.x - 40, h.y - 12, { steps: 25 });
          await p.mouse.up();
        }
        await p.waitForTimeout(3000);
        await glideClick(p, "#lcwApply");
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Set a primary color and a secondary color. An accent color is optional. Pick from the swatch, or type a six digit hex code, such as pound sign one six four F four A. Restore F-N-E Colors puts the standard colors back in the boxes.",
      run: async (p) => {
        await glideTo(p, "#primarySwatch");
        await p.waitForTimeout(1200);
        await typeHex(p, "#primaryHex", "#164F4A");
        await p.waitForTimeout(600);
        await typeHex(p, "#secondaryHex", "#1D6B4F");
        await p.waitForTimeout(600);
        await typeHex(p, "#accentHex", "#F2B84B");
        await p.waitForTimeout(800);
        await glideTo(p, 'button:has-text("Restore FNE Colors")');
      },
    },
    {
      say: "Use the preview tabs to see how a school in your district will look to an administrator, a teacher, a classroom, a student, and a parent. Make sure your logo and colors are easy to read.",
      run: async (p) => {
        for (const tab of ["admin", "teacher", "classroom", "student", "parent"]) {
          await glideClick(p, `#previewTabs [data-tab="${tab}"]`);
          await p.waitForTimeout(1100);
        }
      },
    },
    {
      say: "Select Save Draft to keep your work private. A note below the buttons reminds you when you have changes that haven't been published.",
      run: async (p) => {
        await glideClick(p, 'button:has-text("Save Draft")');
        await p.waitForTimeout(1200);
        await glideTo(p, "#unpublishedNote");
      },
    },
    {
      say: "When it looks right, select Publish Branding and confirm. The schools using the district default pick it up.",
      run: async (p) => {
        await glideClick(p, 'button.sa-btn-primary:has-text("Publish Branding")');
        await p.waitForSelector("#publishModal", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideClick(p, '#publishModal button:has-text("Publish Branding")');
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "Reset to F-N-E Default removes your district branding and goes back to the standard look. It asks you to confirm first.",
      run: (p) => glideTo(p, 'button:has-text("Reset to FNE Default")'),
    },
    { say: "Your district's name is shown at the top of the page, but it can't be edited here. Email support at Fixer Nation Education dot com to change it." },
  ],
};
export default board;
