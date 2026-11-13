"""Remove disconnected pieces from a one-primitive GLB without touching anything else.

usage: willow_clean.py <in.glb> <out.glb> [--keep-near D] [--keep-rank N,N]

Pieces are found after welding by position. The largest piece is always kept.
A smaller piece is kept when it is NOT a strand (height / width below SLENDER)
and it sits within D of the main piece, or when its rank is listed. Materials,
textures, normals, UVs and the node transform are copied unchanged.
"""
import json, struct, sys
import numpy as np
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components
from scipy.spatial import cKDTree

SLENDER = 3.0
src, dst = sys.argv[1], sys.argv[2]
args = sys.argv[3:]
near = float(args[args.index('--keep-near') + 1]) if '--keep-near' in args else 0.01
ranks = set()
if '--keep-rank' in args:
    ranks = {int(x) for x in args[args.index('--keep-rank') + 1].split(',')}

data = open(src, 'rb').read()
jlen = struct.unpack('<I', data[12:16])[0]
g = json.loads(data[20:20 + jlen])
bin_start = 20 + jlen + 8
TYPES = {5123: 'u2', 5125: 'u4', 5126: 'f4'}
COMPS = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}


def accessor(i):
    a = g['accessors'][i]
    bv = g['bufferViews'][a['bufferView']]
    off = bin_start + bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    n = COMPS[a['type']]
    dt = np.dtype(TYPES[a['componentType']])
    stride = bv.get('byteStride') or dt.itemsize * n
    assert stride == dt.itemsize * n, 'interleaved data not handled'
    arr = np.frombuffer(data, dt, a['count'] * n, off)
    return arr.reshape(-1, n) if n > 1 else arr


assert len(g['meshes']) == 1 and len(g['meshes'][0]['primitives']) == 1
prim = g['meshes'][0]['primitives'][0]
assert not prim.get('targets') and 'JOINTS_0' not in prim['attributes']
pos = accessor(prim['attributes']['POSITION'])
idx = accessor(prim['indices']).astype(np.int64).reshape(-1, 3)

span = (pos.max(0) - pos.min(0)).astype(np.float64)
key = np.round(pos.astype(np.float64) / (span.max() * 1e-6)).astype(np.int64)
_, weld = np.unique(key, axis=0, return_inverse=True)
weld = weld.ravel()
t = weld[idx]
nv = weld.max() + 1
rows = np.concatenate([t[:, 0], t[:, 1]])
cols = np.concatenate([t[:, 1], t[:, 2]])
graph = coo_matrix((np.ones(len(rows), dtype=np.int8), (rows, cols)), shape=(nv, nv))
_, labels = connected_components(graph, directed=False)
tri_label = labels[t[:, 0]]
counts = np.bincount(tri_label)
order = np.argsort(-counts)
wp = np.zeros((nv, 3))
wp[weld] = pos

# Z is up in this file: the node rotates it to the game's Y
main = order[0]
tree = cKDTree(wp[labels == main])
keep = {int(main)}
rows_out = []
for rank, c in enumerate(order):
    v = wp[labels == c]
    s = v.max(0) - v.min(0)
    slender = s[2] / max(s[0], s[1], 1e-6)
    gap = float(tree.query(v)[0].min())
    is_kept = rank == 0 or rank in ranks or (slender < SLENDER and gap <= near)
    if is_kept:
        keep.add(int(c))
    rows_out.append((rank, int(counts[c]), s.round(3).tolist(), round(float(slender), 1), round(gap, 4), is_kept))

hist = {'strand': 0, 'not strand': 0}
for r in rows_out[1:]:
    hist['strand' if r[3] >= SLENDER else 'not strand'] += 1
print('pieces', len(rows_out), hist)
print('rank, tris, span xyz, height/width, gap to tree, kept')
for r in rows_out[:3]:
    print(r)
print('--- every non-strand piece')
for r in rows_out[1:]:
    if r[3] < SLENDER:
        print(r)
strands = [r for r in rows_out[1:] if r[3] >= SLENDER]
print('strand gap to tree: touching(<0.002)', sum(r[4] < 0.002 for r in strands), 'of', len(strands), 'max', max(r[4] for r in strands))
print('strand height range', min(r[2][2] for r in strands), max(r[2][2] for r in strands))

# build the output: compact the vertices, copy images byte for byte
tris_mask = np.isin(tri_label, list(keep))


def tri_components(tris):
    """Label triangles that share a welded vertex."""
    uv, inv = np.unique(tris, return_inverse=True)
    inv = inv.reshape(-1, 3)
    n = len(tris) + len(uv)
    r = np.repeat(np.arange(len(tris)), 3)
    c = inv.ravel() + len(tris)
    m = coo_matrix((np.ones(len(r), dtype=np.int8), (r, c)), shape=(n, n))
    _, lab = connected_components(m, directed=False)
    return lab[:len(tris)]


if '--strip-fused' in args:
    MAXW = float(args[args.index('--max-width') + 1]) if '--max-width' in args else 0.014
    MINRUN = float(args[args.index('--min-run') + 1]) if '--min-run' in args else 0.05
    STEP = 0.004
    ids = np.flatnonzero(tris_mask)
    tk = t[ids]
    corners = wp[tk]
    zlo, zhi = corners[:, :, 2].min(1), corners[:, :, 2].max(1)
    thin = np.zeros(len(tk), dtype=bool)
    for z in np.arange(zlo.min(), zhi.max(), STEP):
        sel = np.flatnonzero((zlo <= z) & (zhi >= z))
        if not len(sel):
            continue
        lab = tri_components(tk[sel])
        _, lab = np.unique(lab, return_inverse=True)
        n = lab.max() + 1
        pts = corners[sel]
        lo = np.full((n, 2), np.inf)
        hi = np.full((n, 2), -np.inf)
        np.minimum.at(lo, lab, pts[:, :, :2].min(1))
        np.maximum.at(hi, lab, pts[:, :, :2].max(1))
        width = (hi - lo).max(1)
        thin[sel[width[lab] < MAXW]] = True
    cut = np.zeros(len(tk), dtype=bool)
    thin_ids = np.flatnonzero(thin)
    runs = []
    if len(thin_ids):
        lab = tri_components(tk[thin_ids])
        for c in np.unique(lab):
            members = thin_ids[lab == c]
            run = zhi[members].max() - zlo[members].min()
            if run >= MINRUN:
                cut[members] = True
                p = corners[members].reshape(-1, 3)
                runs.append((len(members), round(float(run), 3), np.round((p.max(0) - p.min(0))[:2], 3).tolist()))
    runs.sort(key=lambda r: -r[1])
    print('fused strands cut', len(runs), 'tris', int(cut.sum()))
    print('tris, height, xy span:', runs[:40])
    tris_mask[ids[cut]] = False
    # anything a cut left floating, apart from the kept pieces
    ids = np.flatnonzero(tris_mask)
    lab = tri_components(t[ids])
    _, lab = np.unique(lab, return_inverse=True)
    sizes = np.bincount(lab)
    print('pieces after cut', sizes[np.argsort(-sizes)][:12].tolist())
    orphan = sizes[lab] < 60
    print('stray fragments dropped', int((sizes < 60).sum()), 'tris', int(orphan.sum()))
    tris_mask[ids[orphan]] = False

new_idx_old = idx[tris_mask]
used, inverse = np.unique(new_idx_old, return_inverse=True)
new_idx = inverse.reshape(-1, 3).astype(np.uint32)
print('tris', len(idx), '->', len(new_idx), ' verts', len(pos), '->', len(used))

blob = bytearray()
views = []


def add(raw, target=None):
    while len(blob) % 4:
        blob.append(0)
    view = {'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(raw)}
    if target:
        view['target'] = target
    blob.extend(raw)
    views.append(view)
    return len(views) - 1


new_acc = []
attrs = {}
for name, ai in prim['attributes'].items():
    a = dict(g['accessors'][ai])
    arr = accessor(ai)[used]
    a['bufferView'] = add(arr.tobytes(), 34962)
    a['byteOffset'] = 0
    a['count'] = len(arr)
    if name == 'POSITION':
        a['min'] = arr.min(0).tolist()
        a['max'] = arr.max(0).tolist()
    attrs[name] = len(new_acc)
    new_acc.append(a)
ia = {'componentType': 5125, 'type': 'SCALAR', 'count': int(new_idx.size), 'byteOffset': 0,
      'bufferView': add(new_idx.tobytes(), 34963)}
prim['indices'] = len(new_acc)
new_acc.append(ia)
prim['attributes'] = attrs
g['accessors'] = new_acc

old_views = g['bufferViews']
for im in g.get('images', []):
    bv = old_views[im['bufferView']]
    off = bin_start + bv.get('byteOffset', 0)
    im['bufferView'] = add(data[off:off + bv['byteLength']])
g['bufferViews'] = views
while len(blob) % 4:
    blob.append(0)
g['buffers'] = [{'byteLength': len(blob)}]

js = json.dumps(g, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
total = 12 + 8 + len(js) + 8 + len(blob)
with open(dst, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(js), 0x4E4F534A))
    f.write(js)
    f.write(struct.pack('<II', len(blob), 0x004E4942))
    f.write(blob)
print('wrote', dst, round(total / 1e6, 1), 'MB (was', round(len(data) / 1e6, 1), 'MB)')
out = pos[used]
print('kept bbox min', out.min(0).round(3).tolist(), 'max', out.max(0).round(3).tolist())
