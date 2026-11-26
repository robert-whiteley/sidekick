"""Scores interpreter bench outputs: chrF (sacrebleu) against the reference per language and
direction, mean time per turn, and for control cases (is the owner talking to Sidekick?) the
END / LANGUAGE / OTHER decisions.

    python score.py out_gemma.jsonl [out_other.jsonl ...]

Each line: {lang, i, who, from, to, src, ref, reply, ms} or, for control cases,
{lang, i, control, asked, src, reply, ms} (see bench/README.md "Interpreter").
"""
import json, re, sys
from collections import defaultdict

from sacrebleu.metrics import CHRF

chrf = CHRF()


def same(a: str, b: str) -> bool:
    k = lambda s: re.sub(r'[\W_]+', '', s.lower())
    return k(a) == k(b)


def say(reply: str, heard: str = '') -> str:
    """Mirror of parseTurnReply (src/engine/interpreter-logic.ts)."""
    t = re.sub(r'```[a-z]*\n?', '', reply)
    t = re.sub(r'<[^>]+>', '', t).strip()
    m = re.search(r'\bSAY\s*\**\s*:\s*\**\s*([^\n]+)', t, re.I)
    lines = [m.group(1)] if m else [l.strip() for l in t.split('\n') if l.strip()]
    pick = next((l for l in lines if not heard or not same(l, heard)), lines[0] if lines else '')
    return pick.strip().strip('"“”«»「」').strip()


def kind(reply: str) -> str:
    """Mirror of parseControlReply: stop, switch:<first two letters>, or say."""
    t = re.sub(r'[`*]', '', reply).strip().split('\n')[0].strip()
    if re.match(r'^(END|STOP)\b', t, re.I):
        return 'stop'
    m = re.match(r'^(?:LANGUAGE|SWITCH)\s*:?\s*(.+)$', t, re.I)
    if m:
        lang = m.group(1).strip().lower()
        return 'switch:' + {'français': 'fr', 'italiano': 'it'}.get(lang, lang[:2])
    return 'say'


for path in sys.argv[1:]:
    rows = [json.loads(l) for l in open(path)]
    groups = defaultdict(list)
    ctl = []
    for r in rows:
        if r.get('control'):
            ctl.append(r)
        else:
            groups[(r['lang'], 'en→xx' if r['from'] == 'en' else 'xx→en')].append(r)
    print(f'## {path}')
    if groups:
        print('lang dir      chrF   ms/turn  n')
    tot = defaultdict(list)
    echoes = 0
    for (lang, d), rs in sorted(groups.items()):
        hyp = [say(r['reply'], r['src']) for r in rs]
        echoes += sum(same(h, r['src']) for h, r in zip(hyp, rs))
        ref = [[r['ref'] for r in rs]]
        s = chrf.corpus_score(hyp, ref).score
        ms = sum(r['ms'] for r in rs) / len(rs)
        tot[d].append(s)
        print(f'{lang:4} {d:7} {s:6.1f} {ms:8.0f} {len(rs):3}')
    for d, v in tot.items():
        print(f'mean {d:7} {sum(v) / len(v):6.1f}')
    if groups:
        print(f'left untranslated (echoed): {echoes}')
    if ctl:
        # What the app does: only lines the word check passes are asked; the rest are translated.
        right = defaultdict(lambda: [0, 0])
        ms = []
        for r in ctl:
            exp = r['control']
            k = kind(r['reply']) if r.get('asked', True) else 'say'
            if r.get('asked', True):
                ms.append(r['ms'])
            right[exp][0] += k == exp
            right[exp][1] += 1
            if k != exp:
                print(f'  miss [{r["lang"]}] {r["src"]!r}: expected {exp}, got {r["reply"]!r}')
        for exp, (ok, n) in sorted(right.items()):
            print(f'{exp:10} right {ok}/{n}')
        if ms:
            print(f'check: {len(ms)} of {len(ctl)} lines asked, {sum(ms) / len(ms):.0f} ms each')
