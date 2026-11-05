// The student PIN lockout, in one place so the login routes, the teacher's classroom page and the staff support console all see the
// same state. Student PINs are 6 digits and usernames are guessable, so the PIN is only as strong as this lockout: 5 failures per
// student in 15 minutes. It lives in the server's memory (like every limit in lib/rate-limit.js), so a restart clears it.
const { FailureTracker } = require('./rate-limit');

const PIN_WINDOW = 15 * 60 * 1000;
const pinFailsByStudent = new FailureTracker({ name: 'pin-student', windowMs: PIN_WINDOW, max: 5 });
// Deliberately generous: a whole class logs in from one school address, and correct PINs never count against it.
const pinFailsByIp = new FailureTracker({ name: 'pin-ip', windowMs: PIN_WINDOW, max: 100 });

// The key every login path uses for one student, so guesses cannot be split across routes.
const studentKey = (username) => 'username:' + String(username).toLowerCase().trim();

// { locked, seconds, minutes } for one username.
function lockStatus(username) {
  const seconds = pinFailsByStudent.blockedFor(studentKey(username));
  return { locked: seconds > 0, seconds, minutes: Math.ceil(seconds / 60) };
}

function clearLock(username) {
  pinFailsByStudent.clear(studentKey(username));
}

module.exports = { pinFailsByStudent, pinFailsByIp, studentKey, lockStatus, clearLock };
