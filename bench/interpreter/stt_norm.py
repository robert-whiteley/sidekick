"""Text normalisation and error counts shared by stt.py and score_stt.py."""
import re, unicodedata

import jiwer

KANJI = '〇一二三四五六七八九'


def kanji_number(n):
    """Arabic numerals as kanji (二十, 三千二百), so "20分" and "二十分" count the same."""
    if n == 0:
        return '〇'
    out = ''
    for v, u in ((10**8, '億'), (10**4, '万')):
        if n >= v:
            out += kanji_number(n // v) + u
            n %= v
    for v, u in ((1000, '千'), (100, '百'), (10, '十')):
        q, n = divmod(n, v)
        if q:
            out += ('' if q == 1 else KANJI[q]) + u
    return out + (KANJI[n] if n else '')


# Arabic: short vowels and other marks, tatweel; alef / yeh / teh marbuta spellings unified.
AR_MARKS = re.compile('[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u0640]')
AR_SAME = str.maketrans({'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ى': 'ي', 'ة': 'ه'})


def norm(s, lang):
    s = unicodedata.normalize('NFKC', s).lower()
    if lang == 'ar':
        s = AR_MARKS.sub('', s).translate(AR_SAME)
    # Bracketed sound tags ("[音楽]") are dropped by the app (Interpreter.kt clean()).
    s = re.sub(r'\[[^\]]*\]|\([^)]*\)|<\|[^|]*\|>', ' ', s)
    if lang == 'ja':
        s = re.sub(r'\d+', lambda m: kanji_number(int(m.group())), s.replace(',', ''))
        return re.sub(r'[\s、。!?,.!?「」『』・\-~〜:;]', '', s)
    return ' '.join(re.sub(r"[^\w' ]+", ' ', s).split())


def errors(ref, hyp, lang):
    """(edits, reference length): characters for Japanese, words otherwise."""
    r, h = norm(ref, lang), norm(hyp, lang)
    o = (jiwer.process_characters if lang == 'ja' else jiwer.process_words)(r, h or ' ')
    return o.substitutions + o.deletions + o.insertions, o.hits + o.substitutions + o.deletions
