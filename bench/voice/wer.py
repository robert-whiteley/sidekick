"""Word error rate of the pipeline's lines against the scripts, per condition (whole
conversations, so words cut between lines still count). Also: how often a person's name was
heard correctly where it was said.

  python wer.py DATA_DIR COND [COND ...]
"""
import json
import re
import sys

import jiwer

ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen " \
       "fifteen sixteen seventeen eighteen nineteen".split()
TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def num(n):
    if n < 20:
        return ONES[n]
    if n < 100:
        return TENS[n // 10] + ("" if n % 10 == 0 else " " + ONES[n % 10])
    if n < 1000:
        return ONES[n // 100] + " hundred" + ("" if n % 100 == 0 else " " + num(n % 100))
    return str(n)


def norm(t):
    t = t.lower().replace("-", " ").replace("’", "'")
    t = re.sub(r"\d+", lambda m: num(int(m.group())), t)
    t = re.sub(r"[^a-z' ]", " ", t)
    t = re.sub(r"\b(mm|um|uh|hmm|ha)\b", " ", t)
    return re.sub(r"\s+", " ", t).strip()


def main(data, conds):
    truth = json.load(open(f"{data}/truth.json"))
    names = {p["name"].lower() for p in truth["people"].values() if p["name"] and p["name"] != "Me"}
    print("cond      WER   names heard")
    for cond in conds:
        base, _, variant = cond.partition("@")
        rows = json.load(open(f"{data}/{base}/segments{'-' + variant if variant else ''}.json"))
        refs, hyps = [], []
        said = heard = 0
        for c in truth["convs"]:
            ref = norm(" ".join(t["text"] for t in c["turns"]))
            hyp = norm(" ".join(r["text"] for r in rows if r["conv"] == c["id"]))
            refs.append(ref)
            hyps.append(hyp)
            hw = hyp.split()
            for w in ref.split():
                if w in names:
                    said += 1
            for n in names:
                k = ref.split().count(n)
                heard += min(k, hw.count(n))
        w = jiwer.wer(refs, hyps)
        print(f"{cond:9} {w * 100:5.1f}% {heard}/{said}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
