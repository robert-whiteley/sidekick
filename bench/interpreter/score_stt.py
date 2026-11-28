"""Summarises stt.py output (scored again with stt_norm.py): error % (all edits / all reference words, or characters for
Japanese), lines with half or more wrong, median seconds per line and the real-time factor,
peak memory, per model, set and language. For Japanese, when pyopenjtalk is installed, also the
error on readings (both sides turned into katakana), so 煙草 / たばこ or 下さい / ください
count as the same; meaning-changing slips still count.

    python score_stt.py out.jsonl [more.jsonl ...]
"""
import collections, json, os, re, statistics, sys, unicodedata

import jiwer

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # stt_norm, also under python -I
from stt_norm import errors  # noqa: E402

try:
    import pyopenjtalk
except ImportError:
    pyopenjtalk = None

rows, rss = collections.defaultdict(dict), {}
for p in sys.argv[1:]:
    for line in open(p):
        r = json.loads(line)
        if 'peak_rss_mb' in r:
            rss[(r['model'], r['set'])] = max(r['peak_rss_mb'], rss.get((r['model'], r['set']), 0))
        else:
            # Scored again here, so a change to stt_norm.py applies to old runs too.
            r['edits'], r['n'] = errors(r['ref'], r['hyp'], r['lang'])
            r['err'] = r['edits'] / max(r['n'], 1)
            rows[(r['model'], r['set'], r['lang'])][r['key']] = r  # a re-run replaces a line


def reading(s):
    s = unicodedata.normalize('NFKC', s)
    s = re.sub(r'\[[^\]]*\]|\([^)]*\)', ' ', s)
    k = pyopenjtalk.g2p(s, kana=True) if s.strip() else ''
    return re.sub(r'[\sー、。!?,.!?「」・’\']', '', k)


def reading_err(rs):
    e = n = 0
    for r in rs:
        ref, hyp = reading(r['ref']), reading(r['hyp'])
        o = jiwer.process_characters(ref, hyp or ' ')
        e += o.substitutions + o.deletions + o.insertions
        n += o.hits + o.substitutions + o.deletions
    return f'{100 * e / max(n, 1):.1f}'


head = '| Model | Set | Lang | Lines | Error % | Reading err % (ja) | Lines ≥50% wrong | s / line (median) | RTF | Peak RSS MB |'
print(head)
print('|' + ' --- |' * (head.count('|') - 1))
for (m, s, l), by in sorted(rows.items(), key=lambda kv: (kv[0][2], kv[0][1], kv[0][0])):
    rs = list(by.values())
    err = 100 * sum(r['edits'] for r in rs) / max(sum(r['n'] for r in rs), 1)
    rd = reading_err(rs) if l == 'ja' and pyopenjtalk else ''
    bad = sum(r['err'] >= 0.5 for r in rs)
    sec = statistics.median(r['sec'] for r in rs)
    rtf = sum(r['sec'] for r in rs) / sum(r['audio_sec'] for r in rs)
    print(f"| {m} | {s} | {l} | {len(rs)} | {err:.1f} | {rd} | {bad} | {sec:.2f} | {rtf:.3f} | {rss.get((m, s), '')} |")
