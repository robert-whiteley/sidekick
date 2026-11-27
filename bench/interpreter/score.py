"""Scores interpreter bench outputs: chrF (sacrebleu) against the reference per language and
direction, mean time per turn, for control cases (is the owner talking to Sidekick?) the
END / LANGUAGE / NO decisions with the second look on END, and routing.ts outputs.

    python score.py out_gemma.jsonl [out_other.jsonl ...]

Each line: {lang, i, who, from, to, src, ref, reply, ms} or, for control cases,
{lang, i, control, src, reply, ms} (see bench/README.md "Interpreter").
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
    """Mirror of parseControlReply (the SIDEKICK: line): stop, switch:<first two letters>, or say."""
    m = re.search(r'(?:^|\n)\s*\**SIDEKICK\s*\**\s*:\s*\**\s*([^\n]*)', reply.replace('`', ''), re.I)
    if not m:
        return 'say'
    t = m.group(1).replace('*', '').strip()
    if re.match(r'^(END|STOP)\b', t, re.I):
        return 'stop'
    m = re.match(r'^(?:LANGUAGE|SWITCH)\s*:?\s*(.+)$', t, re.I)
    if m:
        lang = re.sub(r'[."<>]+', '', m.group(1)).strip().lower()
        if not lang or lang == 'language':
            return 'say'
        return 'switch:' + LANG.get(lang, '?' + lang)
    return 'say'


# Names languageFromName knows (English and own names) for the languages the bench switches to.
LANG = {'french': 'fr', 'français': 'fr', 'italian': 'it', 'italiano': 'it', 'portuguese': 'pt',
        'português': 'pt', 'korean': 'ko', '한국어': 'ko'}


def confirmed(reply: str) -> bool:
    """Mirror of endConfirmed: the second look says END."""
    return bool(re.match(r'^\W*(END|STOP)\b', reply.strip(), re.I))


def decide(r, checks) -> str:
    """What the app does with an owner turn: the turn reply, and a second look on END."""
    k = kind(r['reply'])
    if k == 'stop':
        c = checks.get((r['lang'], r['src']))
        if c is not None and not confirmed(c['reply']):
            return 'say'
    return k


def routing(path, rows):
    """routing.ts output: the sorter's word, then whether the translate call sets talk."""
    sort = {r['src']: r['reply'] for r in rows if r['i'].startswith('sort')}
    ok = defaultdict(lambda: [0, 0])
    for r in rows:
        if not r['i'].startswith('fill'):
            continue
        w = (re.findall(r'[a-z_]+', sort[r['src']].lower()) or [''])[0]
        talk = re.search(r'"talk"\s*:\s*(true|"true")', r['reply'])
        got = 'answer' if w != 'translate' else ('talk' if talk else 'text')
        ok[r['route']][0] += got == r['route']
        ok[r['route']][1] += 1
        if got != r['route']:
            print(f'  miss {r["src"]!r}: {got}')
    print(f'## {path}')
    for k, (a, n) in sorted(ok.items()):
        print(f'{k:7} right {a}/{n}')


for path in sys.argv[1:]:
    rows = [json.loads(l) for l in open(path)]
    if rows and rows[0].get('lang') == 'route':
        routing(path, rows)
        continue
    groups = defaultdict(list)
    ctl = []
    checks = {(r['lang'], r['src']): r for r in rows if r.get('check')}
    for r in rows:
        if r.get('check'):
            continue
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
        owner = [r for r in rows if 'from' in r and r['from'] == 'en']
        wrong = [r for r in owner if decide(r, checks) != 'say']
        print(f'owner turns taken as said to Sidekick: {len(wrong)} of {len(owner)}')
        for r in wrong:
            print(f'  [{r["lang"]}] {r["src"]!r}: {r["reply"]!r}')
    if ctl:
        right = defaultdict(lambda: [0, 0])
        ms = []
        for r in ctl:
            exp = r['control']
            k = decide(r, checks)
            ms.append(r['ms'])
            right[exp][0] += k == exp
            right[exp][1] += 1
            if k != exp:
                print(f'  miss [{r["lang"]}] {r["src"]!r}: expected {exp}, got {r["reply"]!r}')
        for exp, (ok, n) in sorted(right.items()):
            print(f'{exp:10} right {ok}/{n}')
        if ms:
            print(f'control lines: {len(ms)}, {sum(ms) / len(ms):.0f} ms each (whole turn)')
        looked = [r for r in ctl if kind(r['reply']) == 'stop' and (r['lang'], r['src']) in checks]
        if looked:
            cms = [checks[(r['lang'], r['src'])]['ms'] for r in looked]
            print(f'second look on END: {len(looked)} lines, {sum(cms) / len(cms):.0f} ms each')
