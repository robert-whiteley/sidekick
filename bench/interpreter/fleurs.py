"""Real read speech for the speech-to-text bench: the first N clips of the FLEURS test split
(Google, CC BY 4.0) per language, streamed so only the start of each archive is downloaded.

    python fleurs.py OUT_DIR [langs] [N]

langs are FLEURS codes (default ja_jp,ar_eg,de_de,es_419,fr_fr,it_it,pt_br). Writes
OUT_DIR/<code>/<id>.wav (16 kHz mono) and OUT_DIR/<code>/refs.json. Audio is never committed.
"""
import csv, io, json, os, sys, tarfile, urllib.request

OUT = sys.argv[1]
LANGS = (sys.argv[2] if len(sys.argv) > 2 else 'ja_jp,ar_eg,de_de,es_419,fr_fr,it_it,pt_br').split(',')
N = int(sys.argv[3]) if len(sys.argv) > 3 else 60
BASE = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data'

for code in LANGS:
    d = f'{OUT}/{code}'
    os.makedirs(d, exist_ok=True)
    tsv = urllib.request.urlopen(f'{BASE}/{code}/test.tsv').read().decode('utf-8')
    # columns: id, file name, raw transcription, normalised transcription, ...
    ref = {r[1]: r[2] for r in csv.reader(io.StringIO(tsv), delimiter='\t', quoting=csv.QUOTE_NONE)}
    seen, refs = set(), {}
    with urllib.request.urlopen(f'{BASE}/{code}/audio/test.tar.gz') as resp:
        with tarfile.open(fileobj=resp, mode='r|gz') as tar:
            for m in tar:
                name = os.path.basename(m.name)
                if not m.isfile() or name not in ref:
                    continue
                # FLEURS has several speakers per sentence; keep one clip per sentence.
                if ref[name] in seen:
                    continue
                seen.add(ref[name])
                with open(f'{d}/{name}', 'wb') as f:
                    f.write(tar.extractfile(m).read())
                refs[name[:-4]] = ref[name]
                if len(refs) >= N:
                    break
    json.dump(refs, open(f'{d}/refs.json', 'w'), ensure_ascii=False, indent=0)
    print(code, len(refs), flush=True)
