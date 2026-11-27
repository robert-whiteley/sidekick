"""Speech-to-text candidates on the interpreter bench audio (gen_audio.py): words wrong (WER;
characters wrong, CER, for Japanese) and seconds per line, with N CPU threads.

    python stt.py AUDIO_DIR MODELS_DIR MODEL[,MODEL] [langs] [threads] > out.jsonl

MODEL: parakeet-v3 | whisper-base | whisper-small | sense-voice. Whisper is given the
expected language (the side's button says which); Parakeet and SenseVoice detect it.
Needs sherpa-onnx 2.x and jiwer.
"""
import json, os, re, sys, time, unicodedata

import jiwer
import sherpa_onnx as so
import soundfile as sf

AUDIO, MODELS, NAMES = sys.argv[1], sys.argv[2], sys.argv[3].split(',')
LANGS = (sys.argv[4] if len(sys.argv) > 4 else 'en,es,fr,de,it,pt,ja').split(',')
THREADS = int(sys.argv[5]) if len(sys.argv) > 5 else 4
HERE = os.path.dirname(os.path.abspath(__file__))
data = json.load(open(os.path.join(HERE, 'phrases.json')))


def recognizer(name, lang):
    m = MODELS
    if name == 'parakeet-v3':
        d = f'{m}/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8'
        return so.OfflineRecognizer.from_transducer(
            encoder=f'{d}/encoder.int8.onnx', decoder=f'{d}/decoder.int8.onnx',
            joiner=f'{d}/joiner.int8.onnx', tokens=f'{d}/tokens.txt',
            model_type='nemo_transducer', num_threads=THREADS)
    if name.startswith('whisper-'):
        size = name.split('-')[1]
        d = f'{m}/sherpa-onnx-whisper-{size}'
        return so.OfflineRecognizer.from_whisper(
            encoder=f'{d}/{size}-encoder.int8.onnx', decoder=f'{d}/{size}-decoder.int8.onnx',
            tokens=f'{d}/{size}-tokens.txt', language=lang, task='transcribe',
            num_threads=THREADS)
    if name == 'sense-voice':
        d = f'{m}/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09'
        return so.OfflineRecognizer.from_sense_voice(
            model=f'{d}/model.int8.onnx', tokens=f'{d}/tokens.txt', language='auto',
            use_itn=True, num_threads=THREADS)
    raise SystemExit(f'unknown model {name}')


def norm(s, lang):
    s = unicodedata.normalize('NFKC', s).lower()
    if lang == 'ja':
        return re.sub(r'[\s、。!?,.!?「」・ー\-]', '', s)
    return ' '.join(re.sub(r"[^\w' ]+", ' ', s).split())


for name in NAMES:
    for lang in LANGS:
        if name == 'sense-voice' and lang not in ('ja', 'en'):
            continue
        if name == 'parakeet-v3' and lang == 'ja':
            continue
        rec = recognizer(name, lang)
        for f in sorted(os.listdir(f'{AUDIO}/{lang}')):
            key = f[:-4]
            if key.startswith('c'):
                ref = data['control'][int(key[1:])]['en']
            else:
                ref = data['turns'][int(key)][lang]
            x, sr = sf.read(f'{AUDIO}/{lang}/{f}', dtype='float32')
            s = rec.create_stream()
            s.accept_waveform(sr, x)
            t0 = time.time()
            rec.decode_stream(s)
            dt = time.time() - t0
            hyp = s.result.text.strip()
            h, r = norm(hyp, lang), norm(ref, lang)
            err = jiwer.cer(r, h) if lang == 'ja' else jiwer.wer(r, h)
            print(json.dumps({'model': name, 'lang': lang, 'key': key, 'ref': ref, 'hyp': hyp,
                              'err': round(err, 4), 'sec': round(dt, 3),
                              'audio_sec': round(len(x) / sr, 2)}, ensure_ascii=False),
                  flush=True)
