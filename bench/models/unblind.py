"""unblind.py <key.json> <scores.txt> -- totals per run and category from blind scores."""
import json
import sys
from collections import defaultdict

key = json.load(open(sys.argv[1]))
tot = defaultdict(lambda: defaultdict(lambda: [0, 0]))
for line in open(sys.argv[2]):
    f = line.split()
    if not f:
        continue
    cid, sc = f[0], f[1:]
    cat = cid.split('-')[0]
    for tag, s in zip('ABCDEFGH', sc):
        m = key[f'{cid}/{tag}']
        tot[m][cat][0] += int(s)
        tot[m][cat][1] += 2
for m in sorted(tot):
    t = tot[m]
    print(m, {c: f'{a}/{b}' for c, (a, b) in t.items()},
          'all', f"{sum(a for a, _ in t.values())}/{sum(b for _, b in t.values())}")
