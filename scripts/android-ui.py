#!/usr/bin/env python3
"""Reads a uiautomator dump (scripts/android-emu.sh): finds what is on the emulator's screen.

  android-ui.py find <dump.xml> <regex>    centre "X Y" of the first node whose text or
                                           content-desc matches (whole, case-insensitive)
  android-ui.py has <dump.xml> <regex>     exit 0 when any node's text or desc contains a match
  android-ui.py texts <dump.xml>           every text and desc on the screen, one per line
"""
import re
import sys
import xml.etree.ElementTree as ET


def nodes(path):
    try:
        root = ET.parse(path).getroot()
    except (ET.ParseError, OSError):
        return []
    return list(root.iter('node'))


def labels(n):
    return [v for v in (n.get('text') or '', n.get('content-desc') or '') if v]


def centre(n):
    m = re.match(r'\[(\d+),(\d+)\]\[(\d+),(\d+)\]', n.get('bounds') or '')
    if not m:
        return None
    a, b, c, d = map(int, m.groups())
    return (a + c) // 2, (b + d) // 2


def main(argv):
    if len(argv) < 3:
        print(__doc__.strip(), file=sys.stderr)
        return 2
    cmd, path = argv[1], argv[2]
    all_nodes = nodes(path)
    if cmd == 'texts':
        for n in all_nodes:
            for v in labels(n):
                print(v.replace('\n', ' ')[:300])
        return 0
    if len(argv) < 4:
        return 2
    rx = re.compile(argv[3], re.I | re.S)
    if cmd == 'find':
        # Enabled nodes first: a disabled button is skipped while an enabled match exists.
        hits = [n for n in all_nodes if any(rx.fullmatch(v) for v in labels(n))]
        hits.sort(key=lambda n: n.get('enabled') != 'true')
        for n in hits:
            c = centre(n)
            if c:
                print(c[0], c[1])
                return 0
        return 1
    if cmd == 'has':
        return 0 if any(rx.search(v) for n in all_nodes for v in labels(n)) else 1
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv))
