// B6  Brand your school. Signed in as the demo school administrator (Primary) of Maple Elementary.
// The logo is a made-up "Maple Elementary" mark drawn off-camera (a 600 x 200 transparent PNG), never a real school's logo.
// State-changing: restart the test site (tests/howto/stack.sh up) before recording.
import fs from "fs";
import path from "path";
import { chromium } from "@playwright/test";
import { glideClick, glideTo, type Storyboard } from "../pipeline";

const LOGO = path.join(__dirname, "..", "..", "howto-out", "B6", "maple-logo.png");

async function drawLogo() {
  fs.mkdirSync(path.dirname(LOGO), { recursive: true });
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 600, height: 200 } });
  await page.setContent(`<body style="margin:0;background:transparent;font-family:Georgia,serif">
    <div style="display:flex;align-items:center;justify-content:center;height:200px;gap:18px">
      <svg width="96" height="96" viewBox="0 0 96 96"><circle cx="48" cy="48" r="46" fill="#1d6b4f"/><path d="M48 18 58 36 78 38 63 52 68 72 48 62 28 72 33 52 18 38 38 36Z" fill="#f2b84b"/></svg>
      <div><div style="font-size:44px;font-weight:700;color:#1d6b4f;line-height:1">Maple</div><div style="font-size:24px;color:#555;letter-spacing:3px">ELEMENTARY</div></div>
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
  slug: "B6",
  title: "Brand your school",
  as: "school-admin",
  startPath: "/school-admin-dashboard.html",
  setup: drawLogo,
  steps: [
    {
      say: "In this video you'll add your school's logo and colors, so your teachers, students, and parents see your school's look.",
      run: async (p) => {
        await glideClick(p, '.sa-nav a[href="school-admin-branding.html"]');
        await p.waitForLoadState("domcontentloaded");
        await p.waitForSelector("#pageContent", { state: "visible" });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "At the top, your school name is shown, but it can't be changed on this page. Email support at Fixer Nation Education dot com if it needs a correction.",
      run: (p) => glideTo(p, "#brandSchoolName"),
    },
    {
      say: "Select Upload Logo. You can use a P-N-G, J-P-G, WebP, or S-V-G file, up to two megabytes. It should be at least two hundred pixels wide and one hundred pixels tall, or it will look blurry. A transparent P-N-G works best.",
      run: async (p) => {
        const chooser = p.waitForEvent("filechooser");
        await glideClick(p, 'button:has-text("Upload Logo")');
        await (await chooser).setFiles(LOGO);
        await p.waitForSelector("#logoPreviewBox img");
        await p.waitForTimeout(1200);
      },
    },
    {
      say: "After you upload, select Edit Crop to trim the logo, so it fits neatly in the space where it's shown. Drag the box to move it, or drag the corner to resize it, then select Apply Crop. Cropping never changes your original file.",
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
      say: "Next, pick your colors. There's a primary color, a secondary color, and an optional accent. Choose from the color swatch, or type a hex code, such as pound sign one six four F four A.",
      run: async (p) => {
        await glideTo(p, "#primarySwatch");
        await p.waitForTimeout(1200);
        await typeHex(p, "#primaryHex", "#164F4A");
        await p.waitForTimeout(600);
        await typeHex(p, "#secondaryHex", "#1D6B4F");
        await p.waitForTimeout(600);
        await typeHex(p, "#accentHex", "#F2B84B");
      },
    },
    {
      say: "The preview tabs show how your branding looks to an administrator, a teacher, a classroom, a student, and a parent. Click through them to make sure your logo and colors are easy to read.",
      run: async (p) => {
        for (const tab of ["admin", "teacher", "classroom", "student", "parent"]) {
          await glideClick(p, `#previewTabs [data-tab="${tab}"]`);
          await p.waitForTimeout(1100);
        }
      },
    },
    {
      say: "Select Save Draft to keep your work without showing it to anyone. A note below the buttons reminds you when you have changes that haven't been published.",
      run: async (p) => {
        await glideClick(p, 'button:has-text("Save Draft")');
        await p.waitForTimeout(1200);
        await glideTo(p, "#unpublishedNote");
      },
    },
    {
      say: "When you're happy, select Publish Branding and confirm. Your branding goes live right away.",
      run: async (p) => {
        await glideClick(p, 'button.sa-btn-primary:has-text("Publish Branding")');
        await p.waitForSelector("#publishModal", { state: "visible" });
        await p.waitForTimeout(1500);
        await glideClick(p, '#publishModal button:has-text("Publish Branding")');
        await p.waitForTimeout(1500);
      },
    },
    {
      say: "If you ever want to start over, Reset to FNE Default puts the standard look back, and removes your logo. You'll be asked to confirm first.",
      run: (p) => glideTo(p, 'button:has-text("Reset to FNE Default")'),
    },
    { say: "Read only administrators can look at this page, but can't make changes." },
  ],
};
export default board;
