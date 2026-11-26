"""Voice bench dataset: synthesises the made-up scenes in dialogues.py and mixes them with noise
and room echo at several signal-to-noise ratios. Ground truth (who spoke when, and the words) goes
to truth.json. Everything is regenerated from the seed, so only this script lives in the repo.

  python gen.py OUT_DIR MODELS_DIR

Needs sherpa-onnx 1.12.x (2.x dropped the espeak frontend the TTS voices need), numpy, scipy,
soundfile. MODELS_DIR holds kokoro-multi-lang-v1_0 and vits-piper-en_US-libritts_r-medium.
"""
import json
import os
import sys

import numpy as np
import scipy.signal as ss
import soundfile as sf

from dialogues import OWNER, OWNER_QUESTIONS, SCENES

SR = 16000
SEED = 7
# Conversation noises: generated (no recordings, so nothing to license).
NOISES = ["babble", "pink", "street"]
SNRS = [20, 10, 5, 0]
CONDITIONS = [("clean", None, None, False), ("reverb", None, None, True)] + [
    (f"{n}{s}", n, s, True) for n in NOISES for s in SNRS
]
BABBLE_VOICES = list(range(400, 460, 10))  # LibriTTS-R speakers not used by any scene


class Tts:
    def __init__(self, models):
        import sherpa_onnx as so

        k = f"{models}/kokoro-multi-lang-v1_0/"
        p = f"{models}/vits-piper-en_US-libritts_r-medium/"
        self.k = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
            kokoro=so.OfflineTtsKokoroModelConfig(
                model=k + "model.onnx", voices=k + "voices.bin", tokens=k + "tokens.txt",
                data_dir=k + "espeak-ng-data", lexicon=k + "lexicon-us-en.txt"),
            num_threads=6)))
        self.p = so.OfflineTts(so.OfflineTtsConfig(model=so.OfflineTtsModelConfig(
            vits=so.OfflineTtsVitsModelConfig(
                model=p + "en_US-libritts_r-medium.onnx", tokens=p + "tokens.txt",
                data_dir=p + "espeak-ng-data"),
            num_threads=6)))

    def say(self, voice, text, speed=1.0):
        eng, sid = voice
        a = (self.k if eng == "k" else self.p).generate(text, sid=sid, speed=speed)
        x = np.asarray(a.samples, dtype=np.float32)
        g = np.gcd(SR, a.sample_rate)
        x = ss.resample_poly(x, SR // g, a.sample_rate // g).astype(np.float32)
        return trim(x)


def trim(x, db=-40):
    """Cuts the TTS's leading/trailing silence so turn times are where the voice is."""
    env = np.convolve(np.abs(x), np.ones(160) / 160, mode="same")
    on = np.where(env > np.max(env) * 10 ** (db / 20))[0]
    return x[on[0]:on[-1] + 1] if len(on) else x


def rms(x):
    return float(np.sqrt(np.mean(x ** 2) + 1e-12))


def room(rng, rt60=0.45):
    """A synthetic room response: direct sound, then exponentially decaying noise."""
    n = int(rt60 * SR)
    t = np.arange(n) / SR
    tail = rng.standard_normal(n) * np.exp(-6.9 * t / rt60)
    tail[: int(0.003 * SR)] = 0
    h = 0.35 * tail / np.sqrt(np.sum(tail ** 2))
    h[0] = 1.0
    return h.astype(np.float32)


def pink(rng, n):
    f = np.fft.rfftfreq(n, 1 / SR)
    spec = (rng.standard_normal(len(f)) + 1j * rng.standard_normal(len(f))) / np.sqrt(np.maximum(f, 20))
    return np.fft.irfft(spec, n).astype(np.float32)


def street(rng, n):
    """Traffic-like: low rumble with slow swells (cars passing), plus some hiss."""
    b, a = ss.butter(2, 300 / (SR / 2))
    rumble = ss.lfilter(b, a, rng.standard_normal(n))
    swell = 0.5 + 0.5 * np.sin(2 * np.pi * np.cumsum(rng.uniform(0.05, 0.2, n)) / SR) ** 2
    hiss = pink(rng, n)
    return (rumble / rms(rumble) * swell + 0.3 * hiss / rms(hiss)).astype(np.float32)


def babble(tts, rng, n, lines):
    out = np.zeros(n, np.float32)
    for v in BABBLE_VOICES:
        track = []
        total = 0
        while total < n:
            x = tts.say(("p", v), lines[rng.integers(len(lines))])
            track += [x, np.zeros(int(rng.uniform(0.1, 0.5) * SR), np.float32)]
            total += len(x) + len(track[-1])
        t = np.concatenate(track)[:n]
        out += t / rms(t)
    return out


def gap(rng):
    """Pause between turns: real conversation often leaves less than the speech detector's 0.6 s."""
    r = rng.random()
    if r < 0.1:
        return -0.25  # slight overlap: the next person starts before the last one finished
    if r < 0.45:
        return rng.uniform(0.15, 0.55)
    return rng.uniform(0.6, 1.6)


def main(out, models):
    rng = np.random.default_rng(SEED)
    tts = Tts(models)
    os.makedirs(out, exist_ok=True)
    level = {}  # per person: how loud they reach the phone (dB), and their room response

    def person(pid):
        if pid not in level:
            near = pid == "me"
            level[pid] = (0.0 if near else float(rng.uniform(-8, -2)), room(rng, 0.25 if near else 0.5))
        return level[pid]

    convs = []
    # The owner's wake-word questions first (each its own short clip, like separate asks).
    for i, q in enumerate(OWNER_QUESTIONS):
        convs.append({"id": f"owner-q{i}", "scene": None, "turns": [("me", "me", q)]})
    for part in ("a", "b"):
        for sc in SCENES:
            convs.append({"id": f"{sc['id']}-{part}", "scene": sc["id"],
                          "turns": [(k, "me" if k == "me" else f"{sc['id']}/{k}", t) for k, t in sc[part]]})
    voices = {"me": OWNER["voice"]}
    names = {"me": OWNER["name"]}
    roles = {"me": None}
    for sc in SCENES:
        for k, p in sc["people"].items():
            voices[f"{sc['id']}/{k}"] = p["voice"]
            names[f"{sc['id']}/{k}"] = p.get("name")
            roles[f"{sc['id']}/{k}"] = p.get("role")
    all_lines = [t for c in convs for _, _, t in c["turns"]]

    truth = {"people": {pid: {"name": names[pid], "role": roles[pid], "voice": list(voices[pid])} for pid in voices}, "convs": []}
    dry = {}
    for c in convs:
        pos = 0.8
        placed = []
        for _, pid, text in c["turns"]:
            x = tts.say(voices[pid], text, speed=float(rng.uniform(0.92, 1.08)))
            start = pos
            placed.append((pid, start, x, text))
            pos = start + len(x) / SR + gap(rng)
        n = int((pos + 1.0) * SR)
        dry[c["id"]] = (n, placed)
        truth["convs"].append({
            "id": c["id"], "scene": c["scene"], "seconds": n / SR,
            "turns": [{"pid": pid, "start": round(s, 3), "end": round(s + len(x) / SR, 3), "text": t}
                      for pid, s, x, t in placed],
        })
        print("synth", c["id"], f"{n / SR:.0f}s", flush=True)
    with open(f"{out}/truth.json", "w") as f:
        json.dump(truth, f, indent=1)

    longest = max(n for n, _ in dry.values())
    noise_src = {"pink": pink(rng, longest), "street": street(rng, longest),
                 "babble": babble(tts, rng, longest, all_lines)}
    for name, noise, snr, reverb in CONDITIONS:
        os.makedirs(f"{out}/{name}", exist_ok=True)
        for cid, (n, placed) in dry.items():
            mix = np.zeros(n + SR, np.float32)
            active = np.zeros(n + SR, bool)
            for pid, s, x, _ in placed:
                db, h = person(pid)
                y = (ss.fftconvolve(x, h)[: len(x) + len(h) // 2] if reverb else x) * 10 ** (db / 20)
                i = int(s * SR)
                mix[i:i + len(y)] += y
                active[i:i + len(x)] = True
            mix = mix[:n]
            speech = rms(mix[active[:n]])
            if noise:
                off = int(rng.integers(0, max(1, longest - n)))
                z = noise_src[noise][off:off + n]
                mix = mix + z / rms(z) * speech * 10 ** (-snr / 20)
            mix = mix * 0.05 / speech  # speech at about -26 dBFS, like a phone a metre away
            peak = float(np.max(np.abs(mix)))
            if peak > 0.95:
                mix *= 0.95 / peak
            sf.write(f"{out}/{name}/{cid}.wav", mix, SR, subtype="PCM_16")
        print("mixed", name, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
