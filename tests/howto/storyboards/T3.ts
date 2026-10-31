// T3  Create a classroom and add students. Signed in as the demo teacher (Maria Lopez, registered at Maple Elementary).
// Every student name is made up. State-changing: restart the test site (tests/howto/stack.sh up) before recording.
// Regenerate Join Code and Archive each open an in-page confirmation; the video cancels both so the classroom stays as it is.
import { glideClick, glideTo, fillSlowly, type Storyboard } from "../pipeline";

const board: Storyboard = {
  slug: "T3",
  title: "Create a classroom and add students",
  as: "teacher",
  startPath: "/teacher-classrooms.html",
  steps: [
    { say: "In this video you'll set up your first classroom and add your students." },
    {
      say: "Open My Classrooms, and select New Classroom. Give it a name. Grade, subject, and school year are optional.",
      run: async (p) => {
        await p.waitForSelector("text=New Classroom");
        await glideClick(p, "button:has-text('New Classroom')");
        await p.waitForSelector("#createModal.open, #createModal[style*='flex']");
        await fillSlowly(p, "#cName", "Period 3 SEL");
        await glideTo(p, "#cGrade");
        await p.selectOption("#cGrade", "6th Grade");
        await fillSlowly(p, "#cSubject", "Social-Emotional Learning");
        await glideTo(p, "#cYear");
        await p.selectOption("#cYear", "2026–2027");
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Select Create. Every classroom gets an eight character join code. Students use it to join, so keep it handy. You can copy it with the Copy button.",
      run: async (p) => {
        await glideClick(p, "#createBtn");
        await p.waitForURL("**/teacher-classroom.html?id=*");
        await p.waitForSelector("#joinCodeDisplay:not(:text('—'))");
        await p.waitForTimeout(1000);
        await glideTo(p, "#joinCodeDisplay");
        await p.waitForTimeout(2000);
        await glideTo(p, "button:has-text('Copy')");
      },
    },
    {
      say: "To add a student yourself, select Add Student. Type their name, and choose a P-I-N, which is four to six digits. A student I-D number is optional.",
      run: async (p) => {
        await glideClick(p, "button:has-text('+ Add Student')");
        await p.waitForSelector("#addStudentModal.open");
        await fillSlowly(p, "#sName", "Alex Johnson");
        await fillSlowly(p, "#sPin", "482019");
        await glideTo(p, "#sNumber");
      },
    },
    {
      say: "The username is made for you, from the student's first name, in lower case. If someone already has it, a number is added. Students never need an email address.",
      run: async (p) => {
        await glideClick(p, "#addStudentBtn");
        await p.waitForSelector("#studentTable :text('Alex Johnson')");
        await p.waitForTimeout(800);
        await glideTo(p, "#studentTable");
      },
    },
    {
      say: "To add a whole class, select Import C-S-V. Paste one student per line: name, then an optional student number, then an optional P-I-N. Leave the P-I-N off, and we'll make a six digit one for each student.",
      run: async (p) => {
        await glideClick(p, "button:has-text('Import CSV')");
        await p.waitForSelector("#bulkModal.open");
        await p.waitForTimeout(800);
        await glideClick(p, "#bulkText");
        await p.keyboard.type("Sam Lee, 1043\nJordan Smith, 1044\nTaylor Kim, 1045", { delay: 45 });
        await p.waitForTimeout(800);
      },
    },
    {
      say: "Select Import. When it finishes, you'll see each student's username and P-I-N.",
      run: async (p) => {
        await glideClick(p, "#bulkBtn");
        await p.waitForSelector("#credsModal.open");
        await p.waitForTimeout(800);
        await glideTo(p, "#credsBody");
      },
    },
    {
      say: "Save them now, by selecting Copy list. P-I-Ns are stored scrambled, so they can't be shown again. If a student forgets theirs, you can set a new one, which the next video covers.",
      run: async (p) => {
        await glideTo(p, "#credsCopyBtn");
        await p.waitForTimeout(2500);
        await glideClick(p, "#credsModal button:has-text('Done')");
        await p.waitForTimeout(1000);
        await glideTo(p, "#studentTable");
      },
    },
    {
      say: "A couple of controls to know about. Regenerate Join Code stops the old code working for new students. You'll be asked to confirm first, and students already in the class aren't affected.",
      run: async (p) => {
        await p.evaluate(() => window.scrollTo(0, 0));
        await glideClick(p, "button:has-text('Regenerate Join Code')");
        await p.waitForSelector(".fncf-box");
        await p.waitForTimeout(3500);
        await glideClick(p, ".fncf-box button:has-text('Cancel')");
        await p.waitForTimeout(600);
      },
    },
    {
      say: "Archive Classroom closes the classroom, and students can't sign in until you bring it back. It asks you to confirm too, and you can unarchive it any time.",
      run: async (p) => {
        await glideClick(p, "#archiveBtn");
        await p.waitForSelector(".fncf-box");
        await p.waitForTimeout(3500);
        await glideClick(p, ".fncf-box button:has-text('Cancel')");
      },
    },
  ],
};
export default board;
