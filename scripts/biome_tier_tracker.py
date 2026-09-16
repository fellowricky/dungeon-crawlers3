"""Regenerate docs/BIOME_TIER_TRACKER.xlsx from the live game data.

Run this after wiring ANY new monster set:

    python scripts/biome_tier_tracker.py

It reads monsters.json, boss_encounters.json and spawn_budget.json, so it can
never drift from the game the way a hand-maintained list does. Zenu was tracking
these counts from memory and was one off on ancient.

WHAT COUNTS AS DONE, and why it is strict. A level is DONE only when it has at
least MIN_MOOKS theme-EXCLUSIVE animated creatures at that level's anchor CR, AND
its curated boss is animated. Exclusive means the creature's `dungeons` list names
exactly one of the five dungeon themes.

Borrowed creatures deliberately do not count. A level can look perfectly covered
because animated creatures spawn there while every one of them belongs to another
biome - frost level 3 currently fields animated gnolls and orcs, which is how it
got overlooked when choosing what to build next. Counting them would reproduce
exactly that mistake in a spreadsheet.

Level -> CR comes from crAnchorLevels / crAnchorCRs in spawn_budget.json rather
than a hardcoded list, so re-anchoring the curve re-anchors this report too.
Curated bosses carry `dungeons: []`, so they drop out of the mook count on their
own without a special case.
"""
import json
import os
from collections import Counter

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GAME = os.path.join(ROOT, "src", "game")
OUT = os.path.join(ROOT, "docs", "BIOME_TIER_TRACKER.xlsx")

THEMES = ["ancient", "verdant", "frost", "grim", "molten"]
MAX_LEVEL = 20
MIN_MOOKS = 4

FONT = "Arial"
GREEN = PatternFill("solid", fgColor="C6E0B4")
AMBER = PatternFill("solid", fgColor="FFE699")
GREY = PatternFill("solid", fgColor="F2F2F2")
HEAD = PatternFill("solid", fgColor="404040")
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)

# tags that describe a role or a creature type rather than a faction
GENERIC_TAGS = {
    "humanoid", "beast", "undead", "fey", "vermin", "insect", "tribal", "fungal",
    "caster", "spellcaster", "tank", "elite", "boss", "flying", "colony", "wolf",
    "myconid", "spriggan", "thorn", "skeletal", "zombie", "ghoul", "cultist",
    "goblinoid", "orc", "kobold", "wight",
}


def load():
    ms = json.load(open(os.path.join(GAME, "monsters.json"), encoding="utf8"))
    be = json.load(open(os.path.join(GAME, "boss_encounters.json"), encoding="utf8"))
    sb = json.load(open(os.path.join(GAME, "spawn_budget.json"), encoding="utf8"))
    return ms, be, dict(zip(sb["crAnchorLevels"], sb["crAnchorCRs"]))


def animated(m):
    return bool((m.get("animations") or {}).get("idle"))


def exclusive_to(m, theme):
    owned = [d for d in (m.get("dungeons") or []) if d in THEMES]
    return owned == [theme]


def cr_label(cr):
    return {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}.get(cr, str(int(cr)) if cr == int(cr) else str(cr))


def faction_of(mooks):
    """The faction tag a level's creatures share, for the human-readable column."""
    c = Counter(t for m in mooks for t in (m.get("tags") or []) if t not in GENERIC_TAGS)
    if not c:
        return ""
    tag, n = c.most_common(1)[0]
    return tag.replace("-", " ").title() if n >= 2 else ""


def build_rows(ms, be, lvl_cr):
    byid = {m["id"]: m for m in ms}
    rows = []
    for theme in THEMES:
        for lvl in range(1, MAX_LEVEL + 1):
            cr = lvl_cr.get(lvl)
            mooks = [m for m in ms
                     if exclusive_to(m, theme) and m.get("cr") == cr and animated(m)]
            enc = next((e for e in be
                        if e.get("theme") == theme and e.get("level") == lvl), None)
            boss = byid.get(enc["bossId"]) if enc else None
            boss_anim = bool(boss and animated(boss))
            done = len(mooks) >= MIN_MOOKS and boss_anim
            status = "DONE" if done else ("PARTIAL" if (mooks or boss_anim) else "TODO")
            rows.append({
                "theme": theme, "level": lvl, "cr": cr, "cr_label": cr_label(cr),
                "faction": faction_of(mooks), "mooks": len(mooks),
                "boss_id": (enc or {}).get("bossId", ""),
                "boss_anim": "yes" if boss_anim else "no",
                "status": status,
            })
    return rows


def style_header(ws, row, ncols):
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = Font(name=FONT, bold=True, color="FFFFFF", size=11)
        cell.fill = HEAD
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BOX


SOFFICE = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "soffice",
]


def recalc(path):
    """Round-trip through LibreOffice so the COUNTIFS cells carry cached values.

    openpyxl writes formulas as bare strings with no cached result, so until
    something evaluates them the summary reads back as empty to pandas, to
    openpyxl's data_only mode, and to most previewers. Excel itself recalculates
    on open, so this is not strictly required for a human opening the file - but
    it is required for anything that reads the numbers programmatically, which
    includes the next run of this script if it ever grows a diff mode.

    Failure here is non-fatal and reported: the workbook is still correct, its
    five summary cells just have no cached value yet.
    """
    import shutil
    import subprocess
    import tempfile

    exe = next((p for p in SOFFICE if p == "soffice" or os.path.exists(p)), None)
    if not exe:
        print("  (LibreOffice not found - formulas will compute when Excel opens the file)")
        return
    with tempfile.TemporaryDirectory() as tmp:
        try:
            subprocess.run([exe, "--headless", "--norestore", "--convert-to",
                            "xlsx:Calc MS Excel 2007 XML", "--outdir", tmp, path],
                           check=True, capture_output=True, timeout=180)
        except Exception as e:                                    # noqa: BLE001
            print(f"  (recalc skipped: {type(e).__name__})")
            return
        produced = os.path.join(tmp, os.path.basename(path))
        if os.path.exists(produced):
            shutil.copyfile(produced, path)
            print("  recalculated via LibreOffice")


def main():
    ms, be, lvl_cr = load()
    rows = build_rows(ms, be, lvl_cr)

    wb = Workbook()

    # ---------------- Detail: one row per theme x level, the data everything else cites
    det = wb.active
    det.title = "Detail"
    headers = ["Theme", "Level", "CR", "Faction", "Animated mooks (exclusive)",
               "Boss", "Boss animated", "Status"]
    det.append(headers)
    style_header(det, 1, len(headers))
    for r in rows:
        det.append([r["theme"].title(), r["level"], r["cr_label"], r["faction"],
                    r["mooks"], r["boss_id"], r["boss_anim"], r["status"]])
    for i in range(2, len(rows) + 2):
        for c in range(1, len(headers) + 1):
            cell = det.cell(row=i, column=c)
            cell.font = Font(name=FONT, size=10)
            cell.border = BOX
            if c in (2, 3, 5, 7, 8):
                cell.alignment = Alignment(horizontal="center")
        s = det.cell(row=i, column=8)
        s.fill = GREEN if s.value == "DONE" else (AMBER if s.value == "PARTIAL" else GREY)
        s.font = Font(name=FONT, size=10, bold=(s.value == "DONE"))
    for col, w in zip("ABCDEFGH", (11, 7, 7, 20, 26, 26, 15, 11)):
        det.column_dimensions[col].width = w
    det.freeze_panes = "A2"
    det.auto_filter.ref = f"A1:H{len(rows) + 1}"

    # ---------------- Status: the at-a-glance grid
    st = wb.create_sheet("Status")
    st["A1"] = "Dungeon Crawlers - biome completion by level"
    st["A1"].font = Font(name=FONT, bold=True, size=14)
    st["A2"] = (f"A level counts as DONE with >= {MIN_MOOKS} theme-exclusive animated mooks "
                f"at its anchor CR AND an animated boss. Borrowed creatures do not count.")
    st["A2"].font = Font(name=FONT, size=9, italic=True, color="808080")

    st.cell(row=4, column=1, value="Level")
    for lvl in range(1, MAX_LEVEL + 1):
        st.cell(row=4, column=1 + lvl, value=lvl)
    st.cell(row=5, column=1, value="CR")
    for lvl in range(1, MAX_LEVEL + 1):
        st.cell(row=5, column=1 + lvl, value=cr_label(lvl_cr.get(lvl)))
    for c in range(1, MAX_LEVEL + 2):
        for r in (4, 5):
            cell = st.cell(row=r, column=c)
            cell.font = Font(name=FONT, bold=(r == 4), size=10,
                             color="FFFFFF" if r == 4 else "404040")
            if r == 4:
                cell.fill = HEAD
            cell.alignment = Alignment(horizontal="center")
            cell.border = BOX

    by = {(r["theme"], r["level"]): r for r in rows}
    for i, theme in enumerate(THEMES):
        row = 6 + i
        tc = st.cell(row=row, column=1, value=theme.title())
        tc.font = Font(name=FONT, bold=True, size=10)
        tc.border = BOX
        for lvl in range(1, MAX_LEVEL + 1):
            r = by[(theme, lvl)]
            mark = {"DONE": "X", "PARTIAL": "~", "TODO": ""}[r["status"]]
            cell = st.cell(row=row, column=1 + lvl, value=mark)
            cell.fill = (GREEN if r["status"] == "DONE"
                         else AMBER if r["status"] == "PARTIAL" else GREY)
            cell.font = Font(name=FONT, bold=True, size=10)
            cell.alignment = Alignment(horizontal="center")
            cell.border = BOX

    st.cell(row=12, column=1, value="Levels done").font = Font(name=FONT, bold=True, size=10)
    st.cell(row=13, column=1, value="Levels left (of 20)").font = Font(name=FONT, bold=True, size=10)
    for i, theme in enumerate(THEMES):
        col = 2 + i
        st.cell(row=11, column=col, value=theme.title()).font = Font(name=FONT, bold=True, size=10)
        st.cell(row=11, column=col).alignment = Alignment(horizontal="center")
        # counted from the Detail sheet, so the summary recalculates with the data
        st.cell(row=12, column=col,
                value=f'=COUNTIFS(Detail!$A$2:$A${len(rows) + 1},{get_column_letter(col)}$11,'
                      f'Detail!$H$2:$H${len(rows) + 1},"DONE")')
        st.cell(row=13, column=col, value=f"={MAX_LEVEL}-{get_column_letter(col)}12")
        for r in (12, 13):
            c = st.cell(row=r, column=col)
            c.font = Font(name=FONT, size=10)
            c.alignment = Alignment(horizontal="center")
            c.border = BOX
    st.cell(row=11, column=7, value="TOTAL").font = Font(name=FONT, bold=True, size=10)
    st.cell(row=12, column=7, value="=SUM(B12:F12)").font = Font(name=FONT, bold=True, size=10)
    st.cell(row=13, column=7, value=f"={MAX_LEVEL * len(THEMES)}-G12").font = Font(name=FONT, bold=True, size=10)
    for r in (12, 13):
        st.cell(row=r, column=7).border = BOX
        st.cell(row=r, column=7).alignment = Alignment(horizontal="center")

    st.cell(row=15, column=1, value="Legend").font = Font(name=FONT, bold=True, size=10)
    for j, (mark, label, fill) in enumerate([
            ("X", "done - exclusive animated faction + animated boss", GREEN),
            ("~", "partial - some art exists, or boss only", AMBER),
            ("", "nothing purpose-built", GREY)]):
        st.cell(row=16 + j, column=1, value=mark).fill = fill
        st.cell(row=16 + j, column=1).alignment = Alignment(horizontal="center")
        st.cell(row=16 + j, column=1).border = BOX
        st.cell(row=16 + j, column=2, value=label).font = Font(name=FONT, size=9, italic=True)

    st.column_dimensions["A"].width = 20
    for lvl in range(1, MAX_LEVEL + 1):
        st.column_dimensions[get_column_letter(1 + lvl)].width = 4.5

    # ---------------- Next up: the TODO queue, cheapest-first by level
    nx = wb.create_sheet("Next up")
    nh = ["Priority", "Theme", "Level", "CR", "Current boss", "Boss animated",
          "Animated mooks", "What is missing"]
    nx.append(nh)
    style_header(nx, 1, len(nh))
    todo = [r for r in rows if r["status"] != "DONE" and r["level"] <= 10]
    todo.sort(key=lambda r: (r["level"], THEMES.index(r["theme"])))
    for i, r in enumerate(todo, start=1):
        missing = []
        if r["mooks"] < MIN_MOOKS:
            missing.append(f"{MIN_MOOKS - r['mooks']} more exclusive animated mooks")
        if r["boss_anim"] == "no":
            missing.append("animated boss")
        nx.append([i, r["theme"].title(), r["level"], r["cr_label"], r["boss_id"],
                   r["boss_anim"], r["mooks"], "; ".join(missing)])
    for i in range(2, len(todo) + 2):
        for c in range(1, len(nh) + 1):
            cell = nx.cell(row=i, column=c)
            cell.font = Font(name=FONT, size=10)
            cell.border = BOX
            if c in (1, 3, 4, 6, 7):
                cell.alignment = Alignment(horizontal="center")
    for col, w in zip("ABCDEFGH", (9, 11, 7, 7, 26, 15, 16, 46)):
        nx.column_dimensions[col].width = w
    nx.freeze_panes = "A2"

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    wb.save(OUT)
    recalc(OUT)

    done = Counter(r["theme"] for r in rows if r["status"] == "DONE")
    print(f"wrote {OUT}")
    for t in THEMES:
        lv = [r["level"] for r in rows if r["theme"] == t and r["status"] == "DONE"]
        print(f"  {t:9} {done[t]:2d} done  levels {lv}")
    print(f"  {'TOTAL':9} {sum(done.values()):2d} of {MAX_LEVEL * len(THEMES)}")


if __name__ == "__main__":
    main()
