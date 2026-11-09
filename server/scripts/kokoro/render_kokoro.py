"""Renders lines with Kokoro (voice af_heart, on the CPU) into 24 kHz wav files. Used by lib/kokoro-render.js; nothing runs on the live site.

  python render_kokoro.py JOBS.json OUT_DIR [--voice af_heart]

JOBS.json is a list of {"id": "c0", "text": "...", "speed": 0.72}. The text may hold custom pronunciations written as
[word](/phonemes/), for example [B](/bˈi/) for the letter B. Writes OUT_DIR/<id>.wav and OUT_DIR/phonemes.json (what Kokoro decided each
line sounds like, so a wrong pronunciation can be spotted without listening). Needs Python 3.10 to 3.12 with the kokoro and soundfile
packages; the model weights come from Hugging Face on the first run and are cached.
"""
import argparse, json, os, sys, time
import numpy as np
import soundfile as sf
from kokoro import KPipeline

# ---- holding a sound (mmm, zzz, shhh): the first sound of a word the voice says well, cut out and lengthened ----------------------------
# A voice cannot say "mmm" on its own, but it says "Michael" well. A job with "extract" renders the word, finds where its first sound ends
# in the audio itself (the vowel arrives: a nasal's spectrum jumps up, a fricative's zero-crossing rate drops), keeps that first sound, and,
# with "sustain", holds it: a voiced sound (m, z) by repeating a whole number of its pitch periods, an unvoiced one (sh) by resynthesising
# noise with the same spectrum. The vowel never reaches the clip.
def _frames(a, sr, ms=10):
    n = int(sr * ms / 1000)
    out = []
    for i in range(0, len(a) - n, n):
        f = a[i:i + n]
        spec = np.abs(np.fft.rfft(f * np.hanning(len(f))))
        freqs = np.fft.rfftfreq(len(f), 1.0 / sr)
        out.append((i, float(np.sqrt((f ** 2).mean())), float(((f[:-1] * f[1:]) < 0).mean()), float((spec * freqs).sum() / (spec.sum() + 1e-9))))
    return out

def first_sound(a, sr, kind):
    fr = _frames(a, sr)
    # the first sound is often quiet (a hush or a hum is far softer than the vowel after it), so the start is the first sound above silence
    onset = next(i for i, f in enumerate(fr) if f[1] > 0.0015)
    end = None
    for i in range(onset + 3, len(fr) - 1):
        if kind == 'nasal':
            ok = fr[i][3] > 900 and fr[i + 1][3] > 900          # the vowel's formants lift the spectrum
        else:
            ok = fr[i][2] < 0.07 and fr[i + 1][2] < 0.07        # the vowel is periodic: far fewer zero crossings than noise
        if ok:
            end = i
            break
    if end is None:
        end = min(len(fr) - 1, onset + 12)
    start_s, end_s = fr[onset][0], max(fr[end][0] - int(0.01 * sr), fr[onset][0] + int(0.04 * sr))
    return a[start_s:end_s], (start_s / sr, end_s / sr)

def _period(seg, sr):
    mid = seg[len(seg) // 4: 3 * len(seg) // 4]
    mid = mid - mid.mean()
    ac = np.correlate(mid, mid, 'full')[len(mid) - 1:]
    lo, hi = int(sr / 400), min(int(sr / 70), len(ac) - 1)
    return lo + int(np.argmax(ac[lo:hi])) if hi > lo else int(sr / 200)

def sustain_voiced(seg, sr, target):
    P = _period(seg, sr)
    k = max(1, round(0.05 * sr / P)); L = k * P
    mid = len(seg) // 2
    start = max(0, min(mid - L // 2, len(seg) - L))
    unit = seg[start:start + L]
    xf = min(P, L // 2)
    ramp = np.linspace(0, 1, xf)
    out = list(seg[:start])
    body = unit.copy()
    total = len(out) + len(body)
    while total < target * sr - len(seg) + start + L:
        nxt = unit.copy()
        body[-xf:] = body[-xf:] * (1 - ramp) + nxt[:xf] * ramp
        body = np.concatenate([body, nxt[xf:]])
        total = len(out) + len(body)
    tail = seg[start + L:]
    if len(tail):
        t = tail.copy()
        n = min(xf, len(t))
        body[-n:] = body[-n:] * (1 - ramp[:n]) + t[:n] * ramp[:n]
        body = np.concatenate([body, t[n:]])
    return np.concatenate([np.array(out), body])

def sustain_noise(seg, sr, target):
    N, hop = 512, 128
    win = np.hanning(N)
    padded = np.pad(seg, (0, max(0, N - len(seg))))
    mags = np.mean([np.abs(np.fft.rfft(padded[i:i + N] * win)) for i in range(0, len(padded) - N + 1, hop)], axis=0)
    total = int(target * sr)
    out = np.zeros(total + N)
    rng = np.random.default_rng(7)
    for i in range(0, total, hop):
        phase = np.exp(1j * rng.uniform(0, 2 * np.pi, len(mags)))
        out[i:i + N] += np.fft.irfft(mags * phase, N) * win
    out = out[:total]
    fade = int(0.04 * sr)
    out[:fade] *= np.linspace(0, 1, fade); out[-fade:] *= np.linspace(1, 0, fade)
    rms_seg = float(np.sqrt((seg ** 2).mean())); rms_out = float(np.sqrt((out ** 2).mean())) or 1.0
    return out * (rms_seg / rms_out)

def extract_and_sustain(audio, sr, job):
    seg, span = first_sound(audio, sr, 'nasal' if job['extract'] == 'nasal' else 'fricative')
    voiced_fric = job['extract'] == 'voiced-fricative'
    info = {'cut': [round(span[0], 3), round(span[1], 3)], 'cutSeconds': round(len(seg) / sr, 3)}
    if job.get('sustain'):
        seg = (sustain_noise if job['extract'] == 'fricative' else sustain_voiced)(seg, sr, job['sustain'])  # nasal and voiced-fricative are voiced
        info['sustainedSeconds'] = round(len(seg) / sr, 3)
    return seg, info

# ---- a held sound made from scratch -------------------------------------------------------------------------------------------------
# Kokoro says a consonant in about 30 ms, however slowly it is asked to speak, so there is almost nothing to hold. These make the three held
# sounds directly: "shhh" is band-passed noise, "zzz" is a voiced buzz with high noise on top, "mmm" is a nasal hum (low harmonics only).
def synth_sound(kind, seconds, sr=24000):
    n = int(seconds * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(11)
    def bandpass(x, lo, hi):
        spec = np.fft.rfft(x); f = np.fft.rfftfreq(len(x), 1 / sr)
        spec[(f < lo) | (f > hi)] = 0
        return np.fft.irfft(spec, len(x))
    def harmonics(f0, count, tilt, formants=()):
        vib = 1 + 0.008 * np.sin(2 * np.pi * 5 * t)           # a little natural wobble in the pitch
        phase = 2 * np.pi * np.cumsum(f0 * vib) / sr
        out = np.zeros(n)
        for h in range(1, count + 1):
            amp = 1.0 / (h ** tilt)
            for (fc, bw, gain) in formants:
                amp *= 1 + gain * np.exp(-((h * f0 - fc) / bw) ** 2)
            out += amp * np.sin(h * phase)
        return out
    if kind == 'sh':
        x = bandpass(rng.standard_normal(n), 2200, 8500)
    elif kind == 'z':
        voiced = harmonics(190, 30, 1.2)
        noise = bandpass(rng.standard_normal(n), 3500, 9000)
        x = 0.9 * voiced / np.abs(voiced).max() + 0.5 * noise / np.abs(noise).max() * (0.6 + 0.4 * np.sin(2 * np.pi * 190 * t))
    else:  # m
        x = harmonics(200, 12, 1.6, formants=[(260, 120, 5.0), (1100, 250, 0.8)])
    x = x / (np.abs(x).max() + 1e-9) * 0.5
    fade = int(0.08 * sr)
    x[:fade] *= np.linspace(0, 1, fade) ** 1.5; x[-fade:] *= np.linspace(1, 0, fade) ** 1.5
    return x

ap = argparse.ArgumentParser()
ap.add_argument('jobs'); ap.add_argument('out'); ap.add_argument('--voice', default='af_heart')
args = ap.parse_args()

jobs = json.load(open(args.jobs))
os.makedirs(args.out, exist_ok=True)
pipe = KPipeline(lang_code='a', repo_id='hexgrad/Kokoro-82M', device='cpu')
phonemes, failed, cuts, started = {}, [], {}, time.time()
for n, job in enumerate(jobs, 1):
    if job.get('synth'):
        sf.write(os.path.join(args.out, job['id'] + '.wav'), synth_sound(job['synth'], job.get('seconds', 1.0)), 24000)
        phonemes[job['id']] = 'synth:' + job['synth']
        continue
    pieces, ps = [], []
    for result in pipe(job['text'], voice=args.voice, speed=job.get('speed', 0.72)):
        audio = getattr(result, 'audio', None)
        if audio is None:
            audio = result[2]
        pieces.append(audio.detach().cpu().numpy() if hasattr(audio, 'detach') else np.asarray(audio))
        ps.append(getattr(result, 'phonemes', None) or result[1])
    if pieces and job.get('extract'):
        audio, info = extract_and_sustain(np.concatenate(pieces), 24000, job)
        pieces = [audio]
        cuts[job['id']] = info
    if not pieces:
        failed.append(job['id']); print(f"  !! no audio for {job['id']}: {job['text']}", file=sys.stderr, flush=True); continue
    sf.write(os.path.join(args.out, job['id'] + '.wav'), np.concatenate(pieces), 24000)
    phonemes[job['id']] = ' '.join(str(p) for p in ps)
    if n % 25 == 0 or n == len(jobs):
        print(f"  {n}/{len(jobs)}", flush=True)
json.dump(phonemes, open(os.path.join(args.out, 'phonemes.json'), 'w'), ensure_ascii=False, indent=1)
if cuts:
    json.dump(cuts, open(os.path.join(args.out, 'cuts.json'), 'w'), indent=1)
print(f"Rendered {len(phonemes)} line(s) with {args.voice} on the CPU in {time.time() - started:.0f}s" + (f"; {len(failed)} failed" if failed else ''))
sys.exit(1 if failed else 0)
