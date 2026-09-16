"""Copy fresh ComfyUI icon output into the project so the dev server can serve it.

ComfyUI writes outside the repo; vite only serves project-relative paths.
Copies are cheap (~30KB each) and let the picker load them over http.
"""
import os, shutil, json, re, sys

SRC = r"G:\Data\Packages\ComfyUI\output\DC_icons"
DST = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(DST, exist_ok=True)

pat = re.compile(r"^(.*)_(\d{5})_\.png$")
index = {}
n = 0
for f in sorted(os.listdir(SRC)):
    m = pat.match(f)
    if not m:
        continue
    icon_id, var = m.group(1), int(m.group(2))
    if not os.path.exists(os.path.join(DST, f)) or os.path.getsize(os.path.join(SRC, f)) != os.path.getsize(os.path.join(DST, f)):
        shutil.copyfile(os.path.join(SRC, f), os.path.join(DST, f))
        n += 1
    index.setdefault(icon_id, []).append(f)

json.dump(index, open(os.path.join(DST, "index.json"), "w"), indent=1)
print("copied %d new files; %d icons with %d variants total"
      % (n, len(index), sum(len(v) for v in index.values())))
