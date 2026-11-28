"""Makes clean bench audio sound like the phone test: a small speaker playing into a room, heard by
the phone's mic a metre away, with noise. Deterministic (fixed seed per file).

    python degrade.py IN_DIR OUT_DIR

IN_DIR holds <lang>/*.wav (gen_audio.py, fleurs.py). Writes OUT_DIR/room/<lang>/*.wav (speaker,
room echo of about 0.5 s, quiet fan noise at 25 dB SNR) and OUT_DIR/noisy/<lang>/*.wav (the same
plus other people talking, babble at 10 dB SNR). refs.json files are copied. Never committed.
"""
import os, shutil, sys, zlib

import numpy as np
import scipy.signal as ss
import soundfile as sf

IN, OUT = sys.argv[1], sys.argv[2]
SR = 16000


def speaker(x):
    # Small laptop speaker: little below 300 Hz or above 7 kHz, a little distortion when loud.
    b, a = ss.butter(2, [300, 7000], btype='band', fs=SR)
    y = ss.lfilter(b, a, x)
    y = y / (np.max(np.abs(y)) + 1e-9) * 0.8
    return np.tanh(1.5 * y) / np.tanh(1.5)


def room(rng, rt60=0.5):
    # Exponentially decaying noise tail after a direct path, direct-to-reverberant about 0 dB.
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    tail[: int(0.003 * SR)] = 0
    b, a = ss.butter(1, 4000, fs=SR)
    tail = ss.lfilter(b, a, tail)
    h = np.zeros(n)
    h[0] = 1.0
    h += tail / np.sqrt(np.sum(tail**2)) * 1.0
    return h


def pink(rng, n):
    w = np.fft.rfft(rng.standard_normal(n))
    f = np.maximum(np.fft.rfftfreq(n, 1 / SR), 20)
    return np.fft.irfft(w / np.sqrt(f), n)


def mix(x, noise, snr):
    p = np.mean(x**2) + 1e-12
    q = np.mean(noise**2) + 1e-12
    return x + noise * np.sqrt(p / q / 10 ** (snr / 10))


def babble_source():
    # Speech from every clip in IN_DIR, in a fixed order, to cut babble from.
    clips = []
    for lang in sorted(os.listdir(IN)):
        d = f'{IN}/{lang}'
        if os.path.isdir(d):
            for f in sorted(os.listdir(d)):
                if f.endswith('.wav'):
                    clips.append(f'{d}/{f}')
    return clips


CLIPS = babble_source()


def babble(rng, n, own):
    out = np.zeros(n)
    for c in rng.choice([c for c in CLIPS if c != own], 4, replace=False):
        y, _ = sf.read(c, dtype='float32')
        y = np.tile(y, int(np.ceil(n / len(y))) + 1)
        s = rng.integers(0, len(y) - n)
        out += y[s : s + n] / (np.std(y) + 1e-9)
    return out


for lang in sorted(os.listdir(IN)):
    d = f'{IN}/{lang}'
    if not os.path.isdir(d):
        continue
    for cond in ('room', 'noisy'):
        os.makedirs(f'{OUT}/{cond}/{lang}', exist_ok=True)
        if os.path.exists(f'{d}/refs.json'):
            shutil.copy(f'{d}/refs.json', f'{OUT}/{cond}/{lang}/refs.json')
    for f in sorted(os.listdir(d)):
        if not f.endswith('.wav'):
            continue
        x, sr = sf.read(f'{d}/{f}', dtype='float64')
        assert sr == SR, f
        rng = np.random.default_rng(zlib.crc32(f'{lang}/{f}'.encode()))
        y = ss.fftconvolve(speaker(x), room(rng))[: len(x) + SR // 4]
        # The phone's mic high-pass and its gain: a quiet capture, peaks near -12 dBFS.
        b, a = ss.butter(2, 100, btype='high', fs=SR)
        y = ss.lfilter(b, a, y)
        r = mix(y, pink(rng, len(y)), 25)
        nz = mix(r, babble(rng, len(y), f'{d}/{f}'), 10)
        for cond, z in (('room', r), ('noisy', nz)):
            z = z / (np.max(np.abs(z)) + 1e-9) * 0.25
            sf.write(f'{OUT}/{cond}/{lang}/{f}', z.astype(np.float32), SR, subtype='PCM_16')
    print(lang, flush=True)
