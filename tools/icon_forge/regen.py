r"""Re-queue every icon the picker flagged with "Regenerate this one".

    python regen.py            # fresh seeds; a review note replaces the description
    python regen.py --nudge    # also add a stronger legibility clause
    python regen.py --dry      # print the prompts that would be sent, queue nothing

A note from the picker REPLACES the "THE ICON:" clause rather than being appended.
The recipe runs at CFG 1.0, so the negative prompt is inert and a negation in the
positive prompt actively backfires -- the token is still in there, so "not a skull"
yields skulls. Notes phrased as negations are reported and left to be restated
positively rather than silently sent through.

Old variants for the regenerated ids are deleted from raw/ first, so the picker
shows only the new attempt instead of a row that has grown to eight variants.
"""
import glob
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
COMFY_OUT = r"G:\Data\Packages\ComfyUI\output\DC_icons"
NUDGE = (" The shape must be simple, bold and unmistakable at 20 pixels: "
         "thick strokes, no thin lines, no fine detail, high contrast.")
NEGATION = re.compile(r"\b(no|not|non|never|avoid|without|remove|instead of|"
                      r"don'?t|doesn'?t|shouldn'?t|less|stop)\b", re.I)


CORE_RE = re.compile(r"THE ICON: (.*?)\. Palette: ([^.]*)\.", re.S)


def apply_note(prompt, note):
    """Substitute an edited prompt core back into the full prompt.

    The picker prefills its box with this icon's own description and palette, so
    a note is not commentary -- it is the replacement text, used verbatim. The
    header and the shared style tail are preserved around it.

        <description>
        Palette: <palette>
    """
    lines = [ln.strip() for ln in note.strip().splitlines() if ln.strip()]
    palette = None
    for i, ln in enumerate(lines):
        if ln.lower().startswith("palette:"):
            palette = ln.split(":", 1)[1].strip().rstrip(".")
            lines = lines[:i] + lines[i + 1:]
            break
    desc = " ".join(lines).rstrip(". ")

    m = CORE_RE.search(prompt)
    if not m:                      # shape changed: fall back to appending
        return prompt + " " + note
    if palette is None:
        palette = m.group(2).strip()
    return (prompt[:m.start()] + "THE ICON: " + desc + ". Palette: " + palette + "."
            + prompt[m.end():])


def main():
    picks = json.load(open(os.path.join(ROOT, "picks.json"), encoding="utf-8"))
    manifest = {i["id"]: i for i in
                json.load(open(os.path.join(ROOT, "icons.json"), encoding="utf-8"))}
    ids = [k for k, v in picks.items() if v.get("regen")]
    if not ids:
        print("nothing flagged for regeneration")
        return 0

    batch, flagged = [], []
    for icon_id in ids:
        ic = dict(manifest[icon_id])
        ic["seed"] = ic["seed"] + 100000        # new seed, same prompt intent
        note = (picks[icon_id].get("note") or "").strip()
        if note:
            if NEGATION.search(note):
                flagged.append((icon_id, note))
                continue
            ic["prompt"] = apply_note(ic["prompt"], note)
        if "--nudge" in sys.argv:
            ic["prompt"] += NUDGE
        batch.append(ic)

    if flagged:
        print()
        print("%d note(s) are phrased as negations and will not take at CFG 1.0."
              % len(flagged))
        print("Restate each as what the icon SHOULD be, then re-run:")
        for icon_id, note in flagged:
            print("  %-28s %s" % (icon_id, note))
        print()

    if not batch:
        print("nothing left to queue")
        return 1

    if "--dry" in sys.argv:
        for ic in batch:
            print()
            print("=== %s ===" % ic["id"])
            print(ic["prompt"])
        return 0

    # Clear BOTH locations. Deleting only raw/ is not enough: ComfyUI keeps its
    # own output and numbers new files onward from the highest index, so the next
    # sync copies the rejected variants straight back and the row shows eight.
    for ic in batch:
        for d in (os.path.join(ROOT, "raw"), COMFY_OUT):
            for f in glob.glob(os.path.join(d, ic["id"] + "_*.png")):
                os.remove(f)

    path = os.path.join(ROOT, "batch_regen.json")
    json.dump(batch, open(path, "w", encoding="utf-8"), indent=1)
    print("re-queueing %d icons: %s"
          % (len(batch), ", ".join(i["id"] for i in batch)))
    subprocess.run([sys.executable, os.path.join(ROOT, "queue_batch.py"),
                    "batch_regen.json"], check=True)
    subprocess.run([sys.executable, os.path.join(ROOT, "sync_raw.py")], check=True)

    # A regenerated icon is undecided again, so drop the flag and let it fall back
    # into the undecided filter. The edited prompt is KEPT: it is what produced
    # the variants now on screen, and without it the picker would prefill the old
    # description and quietly misrepresent what is being reviewed.
    picks = json.load(open(os.path.join(ROOT, "picks.json"), encoding="utf-8"))
    for ic in batch:
        entry = picks.get(ic["id"], {})
        entry.pop("regen", None)
        entry["regenerated"] = True
        picks[ic["id"]] = entry
    json.dump(picks, open(os.path.join(ROOT, "picks.json"), "w",
                          encoding="utf-8"), indent=1)
    print("cleared the regen flag on %d icons -- they are undecided again"
          % len(batch))
    return 0


if __name__ == "__main__":
    sys.exit(main())
