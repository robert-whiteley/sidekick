"""blind.py <prompts.jsonl> <out_dir> <label=results.jsonl>...

Writes blind.txt (each case's prompt, expected answer and the runs' answers, shuffled as A, B, C...)
for a scorer who does not know which model wrote which, and key.json to unblind.
Scores file: one line per case, "<id> <score A> <score B> ...", 0-2 each; then unblind.py.
"""
import json
import random
import sys

prompts = {json.loads(l)['id']: json.loads(l) for l in open(sys.argv[1]) if l.strip()}
out = sys.argv[2]
runs = {}
for a in sys.argv[3:]:
    label, path = a.split('=', 1)
    runs[label] = {r['id']: r for r in map(json.loads, open(path)) if 'id' in r}
rng = random.Random(11)
key, lines = {}, []
for pid, p in prompts.items():
    have = [l for l in runs if pid in runs[l]]
    rng.shuffle(have)
    q = p['prompt'] if p['cat'] == 'tool' else p['prompt'][-600:]
    lines.append(f"=== {pid} ({p['cat']})\nPrompt given to the model: {q}\nImage: {p.get('image')}\nExpected: {p['expect']}")
    for i, l in enumerate(have):
        tag = 'ABCDEFGH'[i]
        key[f'{pid}/{tag}'] = l
        r = runs[l][pid]
        err = f" [ERROR {r['error']}]" if r.get('error') else ''
        lines.append(f"--- Answer {tag}:\n{r.get('text') or '(empty)'}{err}")
    lines.append('')
open(f'{out}/blind.txt', 'w').write('\n'.join(lines))
json.dump(key, open(f'{out}/key.json', 'w'), indent=1)
