"""Runs the app's own speech pipeline over the voice bench audio, the way MicLoop.kt does:
Silero VAD v6.2.3 (threshold 0.5, 0.6 s silence, 0.3 s speech, 25 s max, 512-sample windows),
0.4 s pre-roll never reaching into the previous line, lines under 0.4 s dropped, Parakeet TDT
0.6B v2 int8 for the words, and a CAM++ voiceprint for lines from 0.5 s. Same model files and
sherpa-onnx version (2.0.2) as the app. Writes one segments.json per condition.

  python pipeline.py DATA_DIR MODELS_DIR VARIANT CONDITION [CONDITION ...]
"""
import json
import sys

import numpy as np
import sherpa_onnx as so
import soundfile as sf

SR = 16000
WINDOW = 512
PREROLL = int(0.4 * SR)
MIN_TRANSCRIBE = int(0.4 * SR)
MIN_VOICEPRINT = int(0.5 * SR)
AGREEMENT = ("yes", "yeah", "yep", "yup", "sure", "of course", "ok", "okay", "fine", "go ahead",
             "no problem", "absolutely", "that's fine", "that is fine", "i don't mind", "not at all")


def engines(models, threads=4):
    p = f"{models}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8/"
    asr = so.OfflineRecognizer.from_transducer(
        encoder=p + "encoder.int8.onnx", decoder=p + "decoder.int8.onnx", joiner=p + "joiner.int8.onnx",
        tokens=p + "tokens.txt", model_type="nemo_transducer", num_threads=threads, sample_rate=SR,
        feature_dim=80)
    spk = so.SpeakerEmbeddingExtractor(so.SpeakerEmbeddingExtractorConfig(
        model=f"{models}/3dspeaker_speech_campplus_sv_en_voxceleb_16k.onnx", num_threads=1))
    return asr, spk


def vad_config(models, min_silence):
    cfg = so.VadModelConfig()
    cfg.silero_vad.model = f"{models}/silero_vad_v6.2.3.onnx"
    cfg.silero_vad.threshold = 0.5
    cfg.silero_vad.min_silence_duration = min_silence
    cfg.silero_vad.min_speech_duration = 0.3
    cfg.silero_vad.max_speech_duration = 25
    cfg.silero_vad.window_size = WINDOW
    cfg.sample_rate = SR
    cfg.num_threads = 1
    return cfg


def vad_pieces(audio, cfg):
    """(start, end) sample indices of what Silero calls speech, in order."""
    vad = so.VoiceActivityDetector(cfg, buffer_size_in_seconds=60)
    out = []

    def drain():
        while not vad.empty():
            seg = vad.front
            out.append((seg.start, seg.start + len(seg.samples)))
            vad.pop()

    for i in range(0, len(audio) - WINDOW + 1, WINDOW):
        vad.accept_waveform(audio[i:i + WINDOW])
        drain()
    vad.flush()
    drain()
    return out


def with_preroll(spans):
    """Each line gets up to 0.4 s from before its start, never reaching into the previous line."""
    out = []
    last_end = 0
    for start, end in spans:
        out.append((max(start - PREROLL, last_end, 0), end))
        last_end = end
    return out


def cos(a, b):
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-9))


def regroup(pieces, voiceprint, change, judge_s, short_split, gap_s=0.6):
    """Speech pieces cut at short pauses, joined back into lines unless the voice changes.
    Pieces closer than [gap_s] (what a 0.6 s detector would have merged) stay one line unless both
    sides are at least [judge_s] long and their voiceprints score under [change]; with
    [short_split], a short piece after a pause also starts its own line."""
    lines = []
    group = None
    last_voice = None
    for start, end in pieces:
        v = voiceprint(start, end) if end - start >= judge_s * SR else None
        if group and start - group[1] < gap_s * SR:
            split = (v is not None and last_voice is not None and cos(v, last_voice) < change) or (
                short_split and v is None)
            if not split:
                group[1] = end
                if v is not None:
                    last_voice = v
                continue
        if group:
            lines.append(tuple(group))
        group = [start, end]
        last_voice = v
    if group:
        lines.append(tuple(group))
    return lines


def overlap(a0, a1, b0, b1):
    return max(0.0, min(a1, b1) - max(a0, b0))


def quietest(audio, around, reach):
    """The quietest 20 ms near [around] (a cut there falls between words, not inside one)."""
    f = 320
    lo = max(0, around - reach)
    hi = min(len(audio) - f, around + reach)
    if hi <= lo:
        return around
    starts = range(lo, hi, f // 2)
    return min(starts, key=lambda i: float(np.sum(audio[i:i + f] ** 2))) + f // 2


def blocks(audio, pieces, block_s):
    """Long speech pieces (no pause to cut at, e.g. in a noisy cafe) in about [block_s] blocks."""
    out = []
    b = int(block_s * SR)
    for a, e in pieces:
        n = (e - a) // b
        if n < 2:
            out.append((a, e))
            continue
        edges = [a] + [quietest(audio, a + k * (e - a) // n, int(0.3 * SR)) for k in range(1, n)] + [e]
        out += [(edges[k], edges[k + 1]) for k in range(n)]
    return out


def resplit(audio, frm, end, cfg, voiceprint, change, judge_s, short_split, block_s=None):
    """A line cut where the voice changes at a short pause inside it (MicLoop's LineSplit)."""
    clip = audio[frm:end]
    pieces = vad_pieces(np.concatenate([clip, np.zeros(SR, np.float32)]), cfg)
    pieces = [(frm + max(0, a), frm + min(len(clip), b)) for a, b in pieces]
    if block_s:
        pieces = blocks(audio, pieces, block_s)
    if len(pieces) < 2:
        return [(frm, end)]
    groups = regroup(pieces, voiceprint, change, judge_s, short_split, gap_s=10)
    if len(groups) < 2:
        return [(frm, end)]
    # Line edges: the line's own start, then each cut halfway through the pause.
    out = []
    for i, (a, b) in enumerate(groups):
        start = frm if i == 0 else (groups[i - 1][1] + a) // 2
        stop = end if i == len(groups) - 1 else (b + groups[i + 1][0]) // 2
        out.append((start, stop))
    return out


def transcribe_words(asr, clip):
    """(word, start seconds) from one transcription; Parakeet marks a word start with a space."""
    s = asr.create_stream()
    s.accept_waveform(SR, clip)
    asr.decode_stream(s)
    words = []
    for tok, at in zip(s.result.tokens, s.result.timestamps):
        if tok.startswith(" ") or not words:
            words.append([tok.strip(), at])
        else:
            words[-1][0] += tok
    return [(w, at) for w, at in words if w]


def main(data, models, variant, conds):
    """variant: "base" (the app today: 0.6 s pauses end a line), "cut:S" (S-second pauses end a
    line), "regroup:S:CHANGE:JUDGE[:short]" (cut at S-second pauses, rejoin same-voice pieces), or
    "resplit:S:CHANGE:JUDGE[:short|:blocksB]" (today's lines, each cut again where the voice
    changes; blocksB: pieces with no pause are also judged in B-second blocks)."""
    truth = json.load(open(f"{data}/truth.json"))
    asr, spk = engines(models)
    kind, *a = variant.split(":")
    min_sil = 0.6 if kind in ("base", "resplit") else float(a[0])
    cfg = vad_config(models, min_sil)
    inner = vad_config(models, float(a[0])) if kind == "resplit" else None
    for cond in conds:
        rows = []
        for c in truth["convs"]:
            audio, sr = sf.read(f"{data}/{cond}/{c['id']}.wav", dtype="float32")
            assert sr == SR

            def voiceprint(frm, end):
                st = spk.create_stream()
                st.accept_waveform(SR, audio[frm:end])
                st.input_finished()
                return np.array(spk.compute(st)) if spk.is_ready(st) else None

            spans = vad_pieces(audio, cfg)
            if kind == "regroup":
                spans = regroup(spans, voiceprint, float(a[1]), float(a[2]), len(a) > 3 and a[3] == "short")
            lines = [((frm, end), [(frm, end)]) for frm, end in with_preroll(spans)]
            opts = a[3:] if kind == "resplit" else []
            block_s = next((float(o[6:]) for o in opts if o.startswith("blocks")), None)
            if kind == "resplit":
                # As the app would: each 0.6 s line is looked at again on its own (worker thread).
                lines = [((frm, end), resplit(audio, frm, end, inner, voiceprint, float(a[1]), float(a[2]),
                                              "short" in opts, block_s)) for (frm, end), _ in lines]
            parts = []
            for (lf, le), cuts in lines:
                if "words" in opts and len(cuts) > 1:
                    # One transcription of the whole line, its words shared out by their times.
                    if le - lf < MIN_TRANSCRIBE:
                        continue
                    words = transcribe_words(asr, audio[lf:le])
                    for frm, end in cuts:
                        w = [t for t, at in words if frm <= lf + at * SR < end]
                        parts.append((frm, end, " ".join(w)))
                else:
                    parts += [(frm, end, None) for frm, end in cuts]
            for frm, end, given in parts:
                clip = audio[frm:end]
                if given is None and len(clip) < MIN_TRANSCRIBE:
                    continue
                if given is None:
                    s = asr.create_stream()
                    s.accept_waveform(SR, clip)
                    asr.decode_stream(s)
                    text = s.result.text.strip()
                else:
                    text = given.strip()
                if not text:
                    continue
                voice = None
                if len(clip) >= MIN_VOICEPRINT or text.lower().startswith(AGREEMENT):
                    v = voiceprint(frm, end)
                    if v is not None:
                        voice = [round(float(x), 5) for x in v]
                t0, t1 = frm / SR, end / SR
                share = {}
                for t in c["turns"]:
                    o = overlap(t0, t1, t["start"], t["end"])
                    if o > 0:
                        share[t["pid"]] = share.get(t["pid"], 0) + o
                total = sum(share.values())
                rows.append({
                    "conv": c["id"], "start": round(t0, 3), "end": round(t1, 3),
                    "durationMs": int(len(clip) * 1000 / SR), "text": text, "voice": voice,
                    "owner": c["id"].startswith("owner-q"),
                    "truth": max(share, key=share.get) if share else None,
                    "purity": round(max(share.values()) / total, 3) if total else 0,
                    "share": {k: round(v, 3) for k, v in share.items()},
                })
        name = "segments.json" if variant == "base" else f"segments-{variant.replace(':', '_')}.json"
        json.dump(rows, open(f"{data}/{cond}/{name}", "w"))
        print(cond, variant, len(rows), flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4:])
