# Project labels (mail merge)

Prints the **description** of every open saumaklúbbur and maintenance project
on sticky labels. Sheet layout: **Avery L7182** (A4, 2 × 8, 105 × 37 mm,
edge to edge), also sold as "16 per sheet, 105 × 37" by most brands.

| File | What it is |
| --- | --- |
| `project-labels.sql` | Query for the data source (open projects, non-empty description) |
| `project-labels-template.docx` | Word mail-merge main document, one «Description» field per label |
| `make-labels.py` | Regenerates the template; given a CSV, also writes a pre-filled `project-labels-merged.docx` |

## Mail merge in Word

1. Supabase → SQL editor → run `project-labels.sql` → **Download CSV**, save as
   `project-labels.csv`.
2. Open `project-labels-template.docx`.
3. **Mailings → Start Mail Merge → Letters** (the labels are already laid out;
   don't pick "Labels", which would rebuild the sheet).
4. **Select Recipients → Use an Existing List…** → pick `project-labels.csv`
   (choose *Unicode (UTF-8)* if Word asks for an encoding, so Icelandic letters
   survive).
5. **Finish & Merge → Edit Individual Documents** → check → print at
   **100 % / "Actual size"**. The labels run to the paper edge, so Word may warn
   that margins are outside the printable area — choose **Ignore**; text is
   padded 6 mm in from each edge.

## Skip the merge

    python3 tools/labels/make-labels.py project-labels.csv

writes `project-labels-merged.docx` next to the CSV, already filled in —
just open and print. Neither the CSV nor the merged file is meant to be
committed (club data; the repo is public).
