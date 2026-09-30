#!/usr/bin/env python3
"""Build the project-label mail-merge files (Avery L7160 / A4, 3x7, 63.5x38.1mm).

  python3 tools/labels/make-labels.py
      -> writes project-labels-template.docx (Word mail-merge main document,
         one «Description» field per label, «Next Record» between labels)

  python3 tools/labels/make-labels.py project-labels.csv
      -> also writes project-labels-merged.docx, the same sheet already filled
         in from the CSV (for printing without running a merge)

The CSV is the output of project-labels.sql (one "Description" column).
Stdlib only; no dependencies.
"""
import csv
import os
import sys
import zipfile
from xml.sax.saxutils import escape

HERE = os.path.dirname(os.path.abspath(__file__))

# Avery L7160 geometry, in twips (1 mm = 56.6929 twips).
def mm(v):
    return round(v * 56.6929)

COLS, ROWS = 3, 7
LABEL_W, LABEL_H, GAP_W = mm(63.5), mm(38.1), mm(2.5)
# Bottom margin is smaller than the sheet's real 15.2 mm so the paragraph Word
# requires after a table still fits on a full page instead of spilling a blank one.
MARGIN_TOP, MARGIN_SIDE, MARGIN_BOTTOM = mm(15.1), mm(7.2), mm(10.0)
PER_PAGE = COLS * ROWS
FONT, SIZE_HALF_PT = "Arial", 18  # 9 pt

def run(text):
    return (
        '<w:r><w:rPr><w:rFonts w:ascii="%s" w:hAnsi="%s" w:cs="%s"/>'
        '<w:sz w:val="%d"/></w:rPr><w:t xml:space="preserve">%s</w:t></w:r>'
        % (FONT, FONT, FONT, SIZE_HALF_PT, escape(text))
    )

def field(instr, placeholder=""):
    fc = lambda t: '<w:r><w:fldChar w:fldCharType="%s"/></w:r>' % t
    out = fc("begin") + '<w:r><w:instrText xml:space="preserve"> %s </w:instrText></w:r>' % instr
    if placeholder:
        out += fc("separate") + run(placeholder)
    return out + fc("end")

def cell(width, body, v_align=True):
    tcpr = '<w:tcW w:w="%d" w:type="dxa"/>' % width
    if v_align:
        tcpr += '<w:vAlign w:val="center"/>'
    return (
        '<w:tc><w:tcPr>%s</w:tcPr><w:p><w:pPr><w:jc w:val="center"/>'
        '<w:spacing w:before="0" w:after="0"/></w:pPr>%s</w:p></w:tc>' % (tcpr, body)
    )

def label_table(bodies):
    """bodies: paragraph runs, one per label, a multiple of COLS long.
    Rows are exact-height, so 7 fill a page and the rest flow onto the next."""
    grid = []
    for c in range(COLS):
        grid.append(LABEL_W)
        if c < COLS - 1:
            grid.append(GAP_W)
    rows = []
    for r in range(len(bodies) // COLS):
        cells = []
        for c in range(COLS):
            cells.append(cell(LABEL_W, bodies[r * COLS + c]))
            if c < COLS - 1:
                cells.append(cell(GAP_W, "", v_align=False))
        rows.append(
            '<w:tr><w:trPr><w:trHeight w:val="%d" w:hRule="exact"/>'
            '<w:cantSplit/></w:trPr>%s</w:tr>' % (LABEL_H, "".join(cells))
        )
    return (
        '<w:tbl><w:tblPr><w:tblW w:w="%d" w:type="dxa"/><w:tblLayout w:type="fixed"/>'
        '<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="%d" w:type="dxa"/>'
        '<w:bottom w:w="0" w:type="dxa"/><w:right w:w="%d" w:type="dxa"/></w:tblCellMar>'
        '<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>%s</w:tblGrid>%s</w:tbl>'
        % (
            sum(grid), mm(2.5), mm(2.5),
            "".join('<w:gridCol w:w="%d"/>' % g for g in grid),
            "".join(rows),
        )
    )

def document(table):
    tiny = ('<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="14" '
            'w:lineRule="exact"/></w:pPr></w:p>')
    sect = (
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" '
        'w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>'
        % (MARGIN_TOP, MARGIN_SIDE, MARGIN_BOTTOM, MARGIN_SIDE)
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        "<w:body>%s%s%s</w:body></w:document>" % (table, tiny, sect)
    )

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    "</Types>"
)
RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/></Relationships>'
)

def write_docx(path, xml):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CONTENT_TYPES)
        z.writestr("_rels/.rels", RELS)
        z.writestr("word/document.xml", xml)
    print("wrote", os.path.relpath(path))

def template():
    # First label reads the current record; every later label advances first.
    # Word's merge repeats the page until the data runs out.
    bodies = [field("MERGEFIELD Description", "«Description»")]
    bodies += [field("NEXT") + field("MERGEFIELD Description", "«Description»")] * (PER_PAGE - 1)
    return document(label_table(bodies))

def merged(descriptions):
    bodies = [run(d) for d in descriptions]
    bodies += [""] * (-len(bodies) % PER_PAGE)  # pad to whole sheets
    return document(label_table(bodies or [""] * PER_PAGE))

def main():
    write_docx(os.path.join(HERE, "project-labels-template.docx"), template())
    if len(sys.argv) > 1:
        src = sys.argv[1]
        with open(src, newline="", encoding="utf-8-sig") as f:
            rows = [(r.get("Description") or r.get("description") or "").strip()
                    for r in csv.DictReader(f)]
        rows = [r for r in rows if r]
        out = os.path.join(os.path.dirname(os.path.abspath(src)), "project-labels-merged.docx")
        write_docx(out, merged(rows))
        print("%d labels, %d page(s)" % (len(rows), -(-len(rows) // PER_PAGE)))

if __name__ == "__main__":
    main()
