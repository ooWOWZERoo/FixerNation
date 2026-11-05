// A student PIN is 4 to 6 digits. The pages check this in the browser; the server checks it too, because a request
// can be sent without the page. typeof first: RegExp.test() coerces, so an array or object could slip through.
const PIN_ERROR = 'PIN must be 4 to 6 digits';
function isValidPin(v) {
  return (typeof v === 'string' || typeof v === 'number') && /^\d{4,6}$/.test(String(v));
}
// A new random 6-digit PIN (staff-issued resets). crypto, never Math.random(): a PIN is guessable-by-design material.
function generatePin() {
  return String(require('crypto').randomInt(100000, 1000000));
}
module.exports = { isValidPin, PIN_ERROR, generatePin };
