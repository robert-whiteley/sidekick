"""summary.py <results.jsonl>... -- medians per category, token speeds, words/s and peak memory."""
import json
import statistics as st
import sys

for p in sys.argv[1:]:
    rs = [json.loads(l) for l in open(p)]
    loads = [r for r in rs if r.get('event') == 'load']
    cs = [r for r in rs if 'id' in r]

    def med(cat, key):
        v = [r[key] for r in cs if r['id'].startswith(cat) and r.get(key, -1) > 0]
        return round(st.median(v), 1) if v else None

    text = [r for r in cs if not r['id'].startswith('photo')]
    words = sum(len(r['text'].split()) for r in text)
    dec_s = sum(r['decode_tok'] / r['decode_tps'] for r in text if r.get('decode_tps', 0) > 0)
    print(p.split('/')[-1], 'loads', [(round(l['load_s'], 1), l['hwm_kb'] // 1024) for l in loads])
    print('  first word median: mem', med('mem', 'first_s'), 'tool', med('tool', 'first_s'),
          'plain', med('q-', 'first_s'), 'photo', med('photo', 'first_s'))
    print('  total median: mem', med('mem', 'total_s'), 'tool', med('tool', 'total_s'),
          'plain', med('q-', 'total_s'), 'photo', med('photo', 'total_s'))
    print('  decode tok/s', round(st.median([r['decode_tps'] for r in cs if r.get('decode_tps', 0) > 0]), 2),
          'prefill tok/s', round(st.median([r['prefill_tps'] for r in cs if r.get('prefill_tps', 0) > 0]), 1),
          'words/s while writing', round(words / dec_s, 2) if dec_s else None,
          'peak MB text', max(r['hwm_kb'] for r in text) // 1024,
          'peak MB all', max(r['hwm_kb'] for r in rs) // 1024, 'n', len(cs))
