#!/usr/bin/env python3
"""Made-up test files for the emulator checks (scripts/android-emu.sh). No real data.

  android-test-files.py <out dir>

Writes one file of each kind the chat's file reader handles (Word, PowerPoint, Excel, CSV, EPUB,
ZIP, an unknown type), an invoice for folder search, a pasted table and a short recording.
"""
import csv
import math
import os
import struct
import sys
import wave
import zipfile

out = sys.argv[1]
os.makedirs(os.path.join(out, 'folder'), exist_ok=True)

CT = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
RELS = 'http://schemas.openxmlformats.org/package/2006/relationships'
OFFICE_DOC = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'


def z(name, files):
    with zipfile.ZipFile(os.path.join(out, name), 'w', zipfile.ZIP_DEFLATED) as f:
        for k, v in files.items():
            f.writestr(k, v)


def types(defaults, overrides):
    return (CT + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>' + defaults
            + ''.join(f'<Override PartName="{p}" ContentType="{t}"/>' for p, t in overrides) + '</Types>')


def rel(target, kind='officeDocument', rid='rId1'):
    return f'<Relationship Id="{rid}" Type="{OFFICE_DOC}/{kind}" Target="{target}"/>'


# Word: a club letter with an entry fee.
z('sk-test-letter.docx', {
    '[Content_Types].xml': types('', [(
        '/word/document.xml',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')]),
    '_rels/.rels': CT + f'<Relationships xmlns="{RELS}">{rel("word/document.xml")}</Relationships>',
    'word/document.xml': CT + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
    + ''.join(f'<w:p><w:r><w:t>{t}</w:t></w:r></w:p>' for t in [
        'Harbour Rowing Club', 'Dear members,',
        'The spring regatta is on Saturday 14 March at Pelican Quay. Boats launch at 8:30.',
        'Bring a packed lunch. The entry fee is 12 pounds per rower, paid to Ines Varga by 1 March.',
        'Yours, the committee']) + '</w:body></w:document>',
})

# PowerPoint: two slides.
slide = ('<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
         'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>{}</p:spTree></p:cSld></p:sld>')
z('sk-test-slides.pptx', {
    '[Content_Types].xml': types('', [
        ('/ppt/presentation.xml', 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml'),
        ('/ppt/slides/slide1.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'),
        ('/ppt/slides/slide2.xml', 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml')]),
    '_rels/.rels': CT + f'<Relationships xmlns="{RELS}">{rel("ppt/presentation.xml")}</Relationships>',
    'ppt/presentation.xml': CT + '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" '
    f'xmlns:r="{OFFICE_DOC}"><p:sldIdLst><p:sldId id="256" r:id="rId2"/><p:sldId id="257" r:id="rId3"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': CT + f'<Relationships xmlns="{RELS}">'
    + rel('slides/slide1.xml', 'slide', 'rId2') + rel('slides/slide2.xml', 'slide', 'rId3') + '</Relationships>',
    **{f'ppt/slides/slide{i}.xml': CT + slide.format(''.join(
        f'<p:sp><p:txBody><a:p><a:r><a:t>{t}</a:t></a:r></a:p></p:txBody></p:sp>' for t in ts))
       for i, ts in [(1, ['Project Kestrel', 'Quarterly update']),
                     (2, ['Budget', 'We spent 41,300 of 50,000 euros. Launch moves to June.'])]},
})

# Excel: four products with net prices (total 195).
rows = [('Item', 'Net price'), ('Desk lamp', 40), ('Notebook', 5), ('Chair', 120), ('Kettle', 30)]


def cell(r, c, v):
    ref = 'AB'[c] + str(r)
    if isinstance(v, str):
        return f'<c r="{ref}" t="inlineStr"><is><t>{v}</t></is></c>'
    return f'<c r="{ref}"><v>{v}</v></c>'


sheet = ''.join(f'<row r="{i + 1}">' + ''.join(cell(i + 1, j, v) for j, v in enumerate(r)) + '</row>'
                for i, r in enumerate(rows))
z('sk-test-prices.xlsx', {
    '[Content_Types].xml': types('', [
        ('/xl/workbook.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml'),
        ('/xl/worksheets/sheet1.xml', 'application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml')]),
    '_rels/.rels': CT + f'<Relationships xmlns="{RELS}">{rel("xl/workbook.xml")}</Relationships>',
    'xl/workbook.xml': CT + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
    f'xmlns:r="{OFFICE_DOC}"><sheets><sheet name="Prices" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': CT + f'<Relationships xmlns="{RELS}">'
    + rel('worksheets/sheet1.xml', 'worksheet') + '</Relationships>',
    'xl/worksheets/sheet1.xml': CT + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    f'<sheetData>{sheet}</sheetData></worksheet>',
})

# CSV: four runs (25.8 km in all).
with open(os.path.join(out, 'sk-test-runs.csv'), 'w', newline='') as f:
    csv.writer(f).writerows([('Date', 'Distance km', 'Minutes'), ('2026-11-02', 5.2, 31),
                             ('2026-11-09', 7.0, 44), ('2026-11-16', 3.5, 20), ('2026-11-23', 10.1, 63)])

# EPUB: one chapter.
z('sk-test-story.epub', {
    'mimetype': 'application/epub+zip',
    'META-INF/container.xml': '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">'
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
    'OEBPS/content.opf': '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">'
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">sk-test</dc:identifier>'
    '<dc:title>The Lantern Fox</dc:title><dc:language>en</dc:language></metadata>'
    '<manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/></manifest>'
    '<spine><itemref idref="c1"/></spine></package>',
    'OEBPS/c1.xhtml': '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>One</title></head><body>'
    '<h1>Chapter One</h1><p>A fox named Tobble carried a green lantern through the marsh every night, '
    'looking for the heron who had stolen his map.</p><p>On the ninth night he found the heron asleep on '
    'the old mill wheel.</p></body></html>',
})

# ZIP: a packing list and the CSV.
with zipfile.ZipFile(os.path.join(out, 'sk-test-bundle.zip'), 'w') as f:
    f.writestr('packing-list.txt', 'Tent, two sleeping bags, stove, 3 gas canisters, map of the Brecon hills.')
    f.write(os.path.join(out, 'sk-test-runs.csv'), 'runs.csv')

# A type nothing reads.
with open(os.path.join(out, 'sk-test-data.qzx'), 'wb') as f:
    f.write(bytes(range(256)) * 8)

# Folder search: two invoices from the same made-up shop; the newer one is wanted.
for name, date, total in [('sk-test-invoice-acme-oct.txt', '2026-10-03', '96.20'),
                          ('sk-test-invoice-acme-nov.txt', '2026-11-21', '184.50')]:
    with open(os.path.join(out, 'folder', name), 'w') as f:
        f.write(f'INVOICE\nAcme Garden Supplies\nInvoice date: {date}\n'
                f'2 x hose reel, 1 x rake, delivery\nTotal due: {total} pounds\nThank you for your order.\n')

# A table pasted with a question (tab-separated cells): Red 31.49, Blue 33.35, Green 15.24.
with open(os.path.join(out, 'sk-test-table.txt'), 'w') as f:
    f.write('What is the total cost for each team?\n'
            'Team\tItem\tCost\nRed\tPaint\t12.40\nBlue\tBrushes\t8.75\nRed\tRollers\t15.10\n'
            'Green\tTape\t3.99\nBlue\tPaint\t24.60\nGreen\tSheets\t11.25\nRed\tTape\t3.99\n')

# A short recording (a soft tone, 16 kHz mono) for a made-up heard line.
with wave.open(os.path.join(out, 'sk-test-heard.wav'), 'w') as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(16000)
    w.writeframes(b''.join(struct.pack('<h', int(3000 * math.sin(2 * math.pi * 440 * i / 16000)))
                           for i in range(16000 * 2)))

print('\n'.join(sorted(os.listdir(out))))
