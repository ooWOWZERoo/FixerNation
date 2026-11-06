/* Fixer Nation Education: a "back to all games" link on every Brain Games page.
   Every game page loads this. It adds one link under the site header that goes to the games page (brain-games.html).
   When a game is shown inside the student classroom page (student-game.html puts it in an iframe), that page already has its
   own "My Classroom" link, so nothing is added there. */
(function () {
  try { if (window.self !== window.top) return; } catch (e) { return; }
  if (document.querySelector('.fn-game-back')) return;

  var style = document.createElement('style');
  style.textContent =
    '.fn-game-back{max-width:1180px;margin:0 auto;padding:14px 32px 0;}' +
    '.fn-game-back a{display:inline-flex;align-items:center;gap:6px;font-family:inherit;font-size:14px;font-weight:700;' +
    'color:#0E3733;text-decoration:none;padding:8px 14px;border-radius:999px;background:rgba(22,79,74,0.08);}' +
    '.fn-game-back a:hover,.fn-game-back a:focus{background:rgba(22,79,74,0.16);text-decoration:underline;}' +
    '@media(max-width:600px){.fn-game-back{padding:12px 20px 0;}}';
  document.head.appendChild(style);

  var nav = document.createElement('nav');
  nav.className = 'fn-game-back';
  nav.setAttribute('aria-label', 'Back to the games page');
  nav.innerHTML = '<a href="brain-games.html">&larr; All Brain Games</a>';

  var header = document.querySelector('header');
  if (header && header.parentNode) header.parentNode.insertBefore(nav, header.nextSibling);
  else document.body.insertBefore(nav, document.body.firstChild);
})();
