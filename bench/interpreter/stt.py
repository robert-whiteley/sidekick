"""Speech-to-text candidates on the interpreter bench audio: words wrong (WER; characters wrong,
CER, for Japanese) and seconds per line, with N CPU threads, through sherpa-onnx (the app's
runtime, 2.x).

    python stt.py AUDIO_DIR MODELS_DIR MODEL[,MODEL] [langs] [threads] [label] > out.jsonl

AUDIO_DIR holds <lang>/*.wav: gen_audio.py's clips (references from phrases.json and
hear-ja.json) or fleurs.py's (refs.json next to them; folder ja_jp counts as ja), clean or from
degrade.py. MODEL is one of the names in recognizer() below; Whisper is told the side's language
(the button says which) unless the name ends in "-auto". The last line per model is its peak
memory (max RSS of this process, so run one model per process to compare). Needs jiwer.
"""
import glob, json, os, resource, sys, time

import sherpa_onnx as so
import soundfile as sf

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # stt_norm, also under python -I
from stt_norm import errors  # noqa: E402

AUDIO, MODELS, NAMES = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
LANGS = (sys.argv[4] if len(sys.argv) > 4 else 'en,es,fr,de,it,pt,ja').split(',')
THREADS = int(sys.argv[5]) if len(sys.argv) > 5 else 4
LABEL = sys.argv[6] if len(sys.argv) > 6 else os.path.basename(os.path.normpath(AUDIO))
HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'phrases.json')))
hear_ja = json.load(open(os.path.join(HERE, 'hear-ja.json')))['lines']


def one(d, pattern):
    """The single file in d matching pattern (export names differ by model)."""
    m = sorted(glob.glob(f'{d}/{pattern}'))
    if not m:
        raise SystemExit(f'missing {d}/{pattern}')
    return m[0]


# Model folders as sherpa-onnx releases name them (asr-models tag).
DIRS = {
    'parakeet-v3': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8',
    'parakeet-ja': 'sherpa-onnx-nemo-parakeet-tdt_ctc-0.6b-ja-35000-int8',
    'reazon': 'sherpa-onnx-zipformer-ja-reazonspeech-2024-08-01',
    'dolphin-base': 'sherpa-onnx-dolphin-base-ctc-multi-lang-int8-2025-04-02',
    'dolphin-small': 'sherpa-onnx-dolphin-small-ctc-multi-lang-int8-2025-04-02',
}
# Languages each model can hear (None: all of the bench's).
COVERS = {'parakeet-v3': {'en', 'es', 'fr', 'de', 'it', 'pt'}, 'parakeet-ja': {'ja'},
          'reazon': {'ja'}}


def recognizer(name, lang):
    m, t = MODELS, THREADS
    if name.startswith('whisper-'):
        size = name.split('-')[1]
        d = f'{m}/sherpa-onnx-whisper-{size}'
        return so.OfflineRecognizer.from_whisper(
            encoder=one(d, '*encoder.int8.onnx'), decoder=one(d, '*decoder.int8.onnx'),
            tokens=one(d, '*tokens.txt'), language='' if name.endswith('-auto') else lang,
            task='transcribe', num_threads=t)
    d = f'{m}/{DIRS[name]}'
    if name == 'parakeet-ja':  # exported as its CTC branch
        return so.OfflineRecognizer.from_nemo_ctc(
            model=one(d, 'model*int8.onnx'), tokens=f'{d}/tokens.txt', num_threads=t)
    if name in ('parakeet-v3', 'reazon'):
        return so.OfflineRecognizer.from_transducer(
            encoder=one(d, 'encoder*int8.onnx'), decoder=one(d, 'decoder*.onnx'),
            joiner=one(d, 'joiner*int8.onnx'), tokens=f'{d}/tokens.txt',
            model_type='' if name == 'reazon' else 'nemo_transducer', num_threads=t)
    if name.startswith('dolphin'):
        return so.OfflineRecognizer.from_dolphin_ctc(
            model=one(d, 'model*int8.onnx'), tokens=f'{d}/tokens.txt', num_threads=t)
    raise SystemExit(f'unknown model {name}')


def reference(d, lang, key):
    if os.path.exists(f'{d}/refs.json'):
        return json.load(open(f'{d}/refs.json'))[key]
    if key.startswith('c'):
        return data['control'][int(key[1:])]['en']
    if key.startswith('h'):
        return hear_ja[int(key[1:])]
    return data['turns'][int(key)][lang]


for name in NAMES:
    base = name.removesuffix('-auto')
    for folder in sorted(os.listdir(AUDIO)):
        lang = folder[:2]
        d = f'{AUDIO}/{folder}'
        if not os.path.isdir(d) or lang not in LANGS:
            continue
        if base in COVERS and lang not in COVERS[base]:
            continue
        rec = recognizer(name, lang)
        for f in sorted(os.listdir(d)):
            if not f.endswith('.wav'):
                continue
            key = f[:-4]
            ref = reference(d, lang, key)
            x, sr = sf.read(f'{d}/{f}', dtype='float32')
            s = rec.create_stream()
            s.accept_waveform(sr, x)
            t0 = time.time()
            rec.decode_stream(s)
            dt = time.time() - t0
            hyp = s.result.text.strip()
            edits, n = errors(ref, hyp, lang)
            err = edits / max(n, 1)
            print(json.dumps({'model': name, 'set': LABEL, 'lang': lang, 'key': key, 'ref': ref,
                              'hyp': hyp, 'err': round(err, 4), 'edits': edits, 'n': n, 'sec': round(dt, 3),
                              'audio_sec': round(len(x) / sr, 2)}, ensure_ascii=False),
                  flush=True)
        del rec
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1024
    print(json.dumps({'model': name, 'set': LABEL, 'peak_rss_mb': round(rss)}), flush=True)
