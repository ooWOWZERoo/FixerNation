// Tune Your Brain: the shared voice for the games that speak.
//
// Every spoken line is a recorded clip of the game voice (Kokoro "Heart"), made ahead of time (server/scripts/build-discover-audio.js and
// build-sound-safari.js) and played from here. There is NO browser voice: a line with no clip is silent, and a test fails if a game can
// speak a line that has no clip. (Before Release 167 a missing clip fell back to the browser's built-in voice.)
//
//   window.FnAudioManifest   { "the exact text of a line": "assets/audio/discover/<hash>.mp3", ... }
//                            written by server/scripts/build-discover-audio.js into assets/audio/discover/<game>.js, which a game
//                            page loads before its engine. The key is the line exactly as the game's content has it, with pictures
//                            (emoji) removed and spaces collapsed (see clean() below; the build script uses the same rule).
//   FnVoice.say(pieces, { gapMs })   plays the clip for each line, in order, with a short pause between them. A line with no clip is
//                            skipped. Returns { done } where done is a promise (true when the last clip ends, false if one failed or it
//                            was stopped), or { done: null } when nothing could play.
//   FnVoice.playUrls(urls, gapMs, onFail)  plays explicit clip files in order (Sound Safari). Same return value.
//   FnVoice.stop()           stops whatever is playing.
//
// Browsers do not let a page play sound before the person has tapped or clicked something on it. When that stops a clip, a small "Tap to hear"
// button appears at the bottom of the screen; one tap plays the line from where it was held up. (Before Release 167 the browser voice quietly
// covered for this; with no browser voice the child needs to be told.)
(function () {
  const clean = (s) => String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();

  let active = null;
  function hidePill() {
    try { const el = document.getElementById('fnVoicePill'); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) { /* no page */ }
  }
  function showPill(resume) {
    try {
      hidePill();
      const b = document.createElement('button');
      b.id = 'fnVoicePill'; b.type = 'button'; b.textContent = '\uD83D\uDD0A Tap to hear';
      b.setAttribute('aria-label', 'Tap to hear this');
      b.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;padding:14px 26px;min-height:48px;border:0;border-radius:999px;background:#164F4A;color:#fff;font:700 17px system-ui,sans-serif;box-shadow:0 14px 30px -10px rgba(0,0,0,.5);cursor:pointer';
      b.addEventListener('click', () => { hidePill(); resume(); });
      document.body.appendChild(b);
    } catch (e) { /* no page to show it on */ }
  }
  function stop() {
    hidePill();
    if (active) active.stop();
    active = null;
  }

  function playUrls(urls, gapMs, onFail) {
    let i = 0, stopped = false, failed = false, timer = null, current = null, finish;
    const done = new Promise((res) => { finish = res; });
    const seq = {
      done,
      stop() { stopped = true; clearTimeout(timer); if (current) { try { current.pause(); } catch (e) { /* already stopped */ } } finish(false); },
    };
    function fail() { if (stopped || failed) return; failed = true; finish(false); if (onFail) onFail(); }
    function next() {
      if (stopped) return;
      if (i >= urls.length) { finish(true); return; }
      let a;
      try { a = new Audio(urls[i++]); } catch (e) { fail(); return; } // no Audio in this browser: nothing can play
      current = a;
      a.addEventListener('ended', () => { timer = setTimeout(next, i < urls.length ? gapMs : 0); });
      a.addEventListener('error', fail);
      a.addEventListener('playing', hidePill);
      a.play().catch((err) => {
        if (err && err.name === 'NotAllowedError' && !stopped) { showPill(() => { if (!stopped) { i -= 1; next(); } }); return; } // wait for a tap
        fail();
      });
    }
    active = seq;
    next();
    return seq;
  }

  function say(pieces, opts) {
    const o = opts || {};
    stop();
    const map = window.FnAudioManifest || {};
    const urls = [].concat(pieces).map(clean).filter(Boolean).map((l) => map[l]).filter(Boolean); // a line with no clip is skipped, never read by a robot
    if (!urls.length) return { done: null };
    const gap = Number.isFinite(Number(o.gapMs)) ? Number(o.gapMs) : 350;
    return playUrls(urls, gap);
  }

  window.FnVoice = { say, playUrls, stop, clean };
})();
