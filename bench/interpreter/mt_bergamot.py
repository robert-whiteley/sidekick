"""Bergamot (Firefox Translations) on the bench cases. Usage: mt_bergamot.py mtdir cases.jsonl out.jsonl"""
import json, os, sys, time
import bergamot

mtdir, cases, out = sys.argv[1:4]
svc = bergamot.Service(bergamot.ServiceConfig(numWorkers=1))
opts = bergamot.ResponseOptions(alignment=False, qualityScores=False, HTML=False)
models = {}


def model(pair):
    if pair not in models:
        d = os.path.join(mtdir, pair)
        sv = 'srcvocab.spm' if os.path.exists(f'{d}/srcvocab.spm') else 'vocab.spm'
        tv = 'trgvocab.spm' if os.path.exists(f'{d}/trgvocab.spm') else 'vocab.spm'
        cfg = f"""models: [{d}/model.bin]
vocabs: [{d}/{sv}, {d}/{tv}]
shortlist: [{d}/lex.bin, false]
beam-size: 1
normalize: 1.0
word-penalty: 0
max-length-break: 128
mini-batch-words: 1024
workspace: 128
max-length-factor: 2.0
skip-cost: true
cpu-threads: 1
quiet: true
quiet-translation: true
gemm-precision: int8shiftAlphaAll
alignment: soft
"""
        models[pair] = svc.modelFromConfig(cfg)
    return models[pair]


with open(out, 'w') as f:
    for line in open(cases):
        c = json.loads(line)
        if c.get('control'):
            continue
        m = model(c['from'] + c['to'])
        t0 = time.time()
        r = svc.translate(m, bergamot.VectorString([c['src']]), opts)
        c['reply'] = r[0].target.text
        c['ms'] = round((time.time() - t0) * 1000)
        c.pop('system'); c.pop('prompt')
        f.write(json.dumps(c, ensure_ascii=False) + '\n')
print('done')
