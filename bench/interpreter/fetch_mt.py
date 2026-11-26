"""Downloads Firefox Translations (Bergamot) models for the bench pairs from Mozilla's public
Remote Settings, newest version per pair, checking each file's SHA-256.

    python fetch_mt.py OUT_DIR   ->  OUT_DIR/<from><to>/{model.bin, lex.bin, vocab.spm | srcvocab.spm + trgvocab.spm}
"""
import hashlib, json, os, sys, urllib.request

RS = 'https://firefox.settings.services.mozilla.com/v1/buckets/main/collections/translations-models/records'
CDN = 'https://firefox-settings-attachments.cdn.mozilla.net/'
LANGS = ['es', 'fr', 'de', 'it', 'pt', 'ja', 'ar']
NAMES = {'model': 'model.bin', 'lex': 'lex.bin', 'vocab': 'vocab.spm',
         'srcvocab': 'srcvocab.spm', 'trgvocab': 'trgvocab.spm'}

out = sys.argv[1]
records = json.load(urllib.request.urlopen(RS))['data']
ver = lambda r: tuple(int(x) for x in r['version'].split('.') if x.isdigit())
best = {}
for r in records:
    if r.get('filter_expression') or r['fileType'] not in NAMES:
        continue
    k = (r['fromLang'], r['toLang'], r['fileType'])
    if k not in best or ver(r) > ver(best[k]):
        best[k] = r
for lang in LANGS:
    for a, b in (('en', lang), (lang, 'en')):
        d = os.path.join(out, a + b)
        os.makedirs(d, exist_ok=True)
        for t, name in NAMES.items():
            r = best.get((a, b, t))
            if not r:
                continue
            p = os.path.join(d, name)
            if not os.path.exists(p):
                data = urllib.request.urlopen(CDN + r['attachment']['location']).read()
                assert hashlib.sha256(data).hexdigest() == r['attachment']['hash'], p
                open(p, 'wb').write(data)
        print(a + b, sorted(os.listdir(d)))
