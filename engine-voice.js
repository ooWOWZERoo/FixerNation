// Tune Your Brain: the shared voice for the audio-led (Discover) games.
//
// Every spoken line used to come from the browser's built-in voice. This plays recorded Ava (Premium) clips instead, and falls back to
// the browser voice for any line that has no clip, so a game is never silent.
//
//   window.FnAudioManifest   { "the exact text of a line": "assets/audio/discover/<hash>.mp3", ... }
//                            written by server/scripts/build-discover-audio.js into assets/audio/discover/<game>.js, which a game
//                            page loads before its engine. The key is the line exactly as the game's content has it, with pictures
//                            (emoji) removed and spaces collapsed (see clean() below; the build script uses the same rule).
//   FnVoice.say(pieces, { rate, gapMs })   speaks a list of lines in order. If every line has a clip, the clips play one after another
//                            with a short pause between them; otherwise the whole list is read by the browser voice at `rate`.
//                            Returns { done } where done is a promise (true when the last clip ends, false if one failed or it was
//                            stopped) when clips are playing, or null when the browser voice is reading.
//   FnVoice.playUrls(urls, gapMs, onFail)  plays explicit clip files in order (Sound Safari). Same return value.
//   FnVoice.stop()           stops whatever is playing.
(function () {
  const clean = (s) => String(s == null ? '' : s).replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
  const sentence = (x) => (/[.?!]$/.test(x) ? x : x + '.');

  let active = null;
  function stop() {
    if (active) active.stop();
    active = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* no browser voice */ }
  }

  function browserSpeak(text, rate) {
    if (!window.speechSynthesis || !text) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      if (rate && rate !== 1) u.rate = rate;
      window.speechSynthesis.speak(u);
    } catch (e) { /* no browser voice */ }
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
      try { a = new Audio(urls[i++]); } catch (e) { fail(); return; } // no Audio in this browser: the browser voice takes over
      current = a;
      a.addEventListener('ended', () => { timer = setTimeout(next, i < urls.length ? gapMs : 0); });
      a.addEventListener('error', fail);
      a.play().catch(fail);
    }
    active = seq;
    next();
    return seq;
  }

  function say(pieces, opts) {
    const o = opts || {};
    stop();
    const lines = [].concat(pieces).map(clean).filter(Boolean);
    if (!lines.length) return { done: null };
    const map = window.FnAudioManifest || {};
    const urls = lines.map((l) => map[l]);
    const gap = Number.isFinite(Number(o.gapMs)) ? Number(o.gapMs) : 350;
    const spoken = lines.map(sentence).join(' ');
    if (urls.every(Boolean)) return playUrls(urls, gap, () => browserSpeak(spoken, o.rate));
    browserSpeak(spoken, o.rate);
    return { done: null };
  }

  window.FnVoice = { say, playUrls, stop, clean };
})();
