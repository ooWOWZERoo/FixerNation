# The game voice: Kokoro "Heart"

Every game that speaks uses one voice: **Kokoro** (open model, Apache-2.0), voice **`af_heart`**, run on the **CPU**. It replaced the macOS "Ava (Premium)" voice and the browser's built-in voice in Release 167, after a blind listening test on 32 real game lines (the owner picked Kokoro by a wide margin). The how-to **videos** are separate and still use Ava.

## How it works

- Clips are made ahead of time and committed: `assets/audio/discover/<hash>.mp3` (one per line, plus a manifest `<game>.js` per game) and `assets/audio/sound-safari/*.mp3`. Nothing is generated on the live site, and no student device ever contacts a third party.
- `engine-voice.js` looks each spoken line up in the game's manifest by its exact text and plays the clip. **There is no browser voice.** A line with no clip is silent, and `server/test/discover-audio.test.js` fails if a game can speak a line that has no clip, or if any page calls `speechSynthesis`.
- Games with clips: the 15 audio-led Discover games plus Strength Spotter, Values Compass, Know Yourself, Know Your Triggers, Stress Signals and What Helps Me (their stories, cues, check-in questions and "Your turn" steps; the finished "My ... card" is built from the child's own words, so it is on screen only in those games), and Sound Safari.

## Making or remaking clips

```bash
cd /Users/john.shaw/Documents/Claude/Projects/FixerNation/server
node scripts/build-discover-audio.js            # what is missing
node scripts/build-discover-audio.js --audio    # render the missing clips, rewrite manifests and page tags
node scripts/build-sound-safari.js --audio      # the Sound Safari clips (add --force to redo all)
node scripts/kokoro/sound-check.js              # a listening page for letters and sounds (tests/howto-out/kokoro-pilot/sound-check/)
```

Change a line in a game, run the first command with `--audio`, commit the page, the manifest and the new clips. **When the voice or its settings change** (speed, voice, finishing), change `VOICE_TAG` in `scripts/build-discover-audio.js` and `CLIP_VERSION` in `scripts/build-sound-safari.js`: every clip then gets a new address, so no browser or school cache keeps an old recording.

## One-time setup (the `kokoro` package needs Python 3.10 to 3.12, not 3.13)

```bash
cd /Users/john.shaw/Documents/Claude/Projects/FixerNation/tests/howto-out/kokoro-pilot
python3 -m venv .venv && ./.venv/bin/pip install uv
./.venv/bin/uv python install 3.12
./.venv/bin/uv venv --python 3.12 .venv-kokoro
VIRTUAL_ENV=$PWD/.venv-kokoro ./.venv/bin/uv pip install kokoro soundfile pip
./.venv-kokoro/bin/python -m spacy download en_core_web_sm
```

That folder is git-ignored (about 900 MB; the model weights, about 313 MB, cache in `~/.cache/huggingface`). Set `KOKORO_PYTHON` to use a different Python. Rendering all clips takes a while on a laptop CPU; run it in the background.

## Settings (`server/lib/kokoro-render.js`)

Speed **0.72** for sentences, questions and words (about 145 words a minute, natural for kindergarten to 2nd grade; 0.85 was too fast), **0.6** for an isolated sound, stretched further (pitch kept) if still shorter than 0.7 s. Kokoro's own half second of silence at each end is trimmed, then 150 ms before and 250 ms after are added so a browser never clips the first or last sound, and every clip is brought to the same peak (-1.5 dB), 56k mono mp3.

## Letters and sounds (the part that goes wrong with any voice)

A voice reads a lone "A" as the article, "are" as a word and "el" with the wrong stress, and cannot say "buh" from the spelling. So (`server/lib/voice-text.js`):

- **"the letter X"** is written for the voice as `the letter [X](/phonemes/)`.
- **Letter Sounds' answers** are spelled letter names ("bee", "are", "double you"); in that game each is said from the letter's phonemes with a full stop, and gets its own clip (named from the letter, not the word), so the insect "bee" in Rhyme Time and the letter B never share a file.
- **Sound Safari's sounds** are phonemes too (`SOUND_IPA` in `scripts/build-sound-safari.js`), each said as a short syllable with a stressed vowel after a lead-in word ("Sound. buh."), keeping only what follows the pause (`keepLast` in `lib/kokoro-render.js`): buh, tuh, kuh, muh, shuh, and "zee" for z. A lone letter name is rendered the same way after "Letter.". The owner chose both by ear. Kokoro says a consonant in about 30 ms however slowly it is asked, so a held "mmm", "zzz" or "shhh" (cut from "Michael", "Zebra" or "Shame", or built from scratch with `extract`/`hold`/`synth` in `render_kokoro.py`) was tried and not chosen.
- Kokoro's pronunciation markup is `[text](/phonemes/)` in its own alphabet; capital A, I, O, W and Y stand for the long vowels "ay", "eye", "oh", "ow" and "oy".

The owner approves these **by ear**: open `tests/howto-out/kokoro-pilot/sound-check/sound-check.html` (letters and alternative spellings of each sound) and `docs/tune-your-brain/sound-safari-audition.html` (the real rounds). A spelling that sounds wrong is fixed in `LETTER_IPA` or `SOUND_IPA`, then re-rendered.

**Opening the listening pages:** a page opened straight from disk (`open /path/page.html`) may not load clips from a folder above it (Safari in particular), and then stays silent. Open them through the local test site instead (`http://localhost:3002/docs/tune-your-brain/sound-safari-audition.html`, after `tests/howto/stack.sh up`), or use the self-contained copy the Sound Safari builder writes next to its own clips: `tests/howto-out/kokoro-pilot/sound-safari-audition/index.html`.

## Why not something else

Alternatives were Ava only (macOS-only, not open, flatter to the owner's ear) and the browser voice (different on every device, robotic). Kokoro is small enough to run on a laptop CPU, open-weight, and rendered offline. One caveat for a lawyer's list: the model card says some of its training audio came from closed commercial TTS providers; the weights themselves are Apache-2.0.
