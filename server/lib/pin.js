// A student PIN is 4 to 6 digits. The pages check this in the browser; the server checks it too, because a request
// can be sent without the page. typeof first: RegExp.test() coerces, so an array or object could slip through.
const PIN_ERROR = 'PIN must be 4 to 6 digits';
function isValidPin(v) {
  return (typeof v === 'string' || typeof v === 'number') && /^\d{4,6}$/.test(String(v));
}
module.exports = { isValidPin, PIN_ERROR };
