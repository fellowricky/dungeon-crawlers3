"""Queue several DC-pixel.json jobs at once and wait for the whole batch.

Usage:  python gen_batch.py <prefix>:<aspect>:<promptfile>[:<seed>] ...
"""
import json, sys, time, random, urllib.request, os

COMFY = 'http://192.168.2.19:8188'
WORKFLOW = r'G:\ClaudesFolder\data\custom_workflows\DC-pixel.json'
OUTDIR = r'G:\ClaudesFolder\dungeon-crawlers\scratch\art_poc'

ASPECT = {
    'pano': '16:9 (Panorama)', 'cine': '8:5 (Cinematic View)',
    'wide': '3:2 (Golden Landscape)', 'land': '4:3 (Classic Landscape)',
    'square': '1:1 (Perfect Square)', 'port': '3:4 (Golden Ratio)',
}
STYLE_HEAD = ("Desimulate, Modern hi-bit pixel art scene in a dynamic cinematic "
              "composition with dark fantasy grunge aesthetic. ")
STYLE_TAIL = ("\n\nHi-bit pixel art style with clean sprites, detailed shading, rich but "
              "darker color gradients and cinematic framing. Gritty dark fantasy aesthetic "
              "with weathered textures, battle damage, smoke, and atmospheric gloom. "
              "No watermarks, no borders, no text, pure pixel art illustration.")

# Landscape variant: the default tail's "battle damage / smoke" keywords bleed
# stray fires and smoke columns into empty scenery, so drop them for wide
# establishing shots and lean on weather and atmosphere instead.
STYLE_TAIL_LAND = ("\n\nHi-bit pixel art style with clean sprites, detailed shading, rich but "
                   "darker color gradients and wide cinematic framing. Bleak dark fantasy "
                   "landscape aesthetic with weathered natural textures, heavy weather, mist "
                   "and atmospheric gloom. Deep atmospheric perspective. "
                   "No watermarks, no borders, no text, pure pixel art illustration.")

# Warm variant: Ch4 is deliberately the one bright, ceremonial, well-lit beat in
# Act I, so the grunge/gloom keywords are dropped entirely for it.
STYLE_TAIL_WARM = ("\n\nHi-bit pixel art style with clean sprites, detailed shading, rich warm "
                   "color gradients and cinematic framing. Warm, inviting, richly lit fantasy "
                   "aesthetic — firelight, lamplight, polished wood, banners and celebration. "
                   "Clean and well-kept rather than ruined or grimy. Strictly a pre-industrial "
                   "medieval fantasy world: no modern clothing, no modern objects, nothing "
                   "contemporary anywhere in the scene. "
                   "No watermarks, no borders, no text, pure pixel art illustration.")


def build(prefix, aspect_key, prompt_file, seed):
    with open(prompt_file, 'r', encoding='utf-8') as f:
        scene = f.read().strip()
    # A leading "#LANDSCAPE" marker line selects the scenery-safe style tail.
    tail = STYLE_TAIL
    if scene.startswith('#LANDSCAPE'):
        scene = scene.split('\n', 1)[1].strip()
        tail = STYLE_TAIL_LAND
    elif scene.startswith('#WARM'):
        scene = scene.split('\n', 1)[1].strip()
        tail = STYLE_TAIL_WARM
    prompt = STYLE_HEAD + scene + tail
    with open(WORKFLOW, 'r', encoding='utf-8') as f:
        wf = json.load(f)
    wf['3']['inputs']['latent_image'] = ['29', 0]
    for n in ('105:93', '105:104:94', '105:104:95', '105:104:92', '105:104:96'):
        wf.pop(n, None)
    wf['103']['inputs']['wildcard_text'] = prompt
    wf['103']['inputs']['populated_text'] = prompt
    wf['103']['inputs']['seed'] = seed
    wf['28']['inputs']['aspect_ratio'] = ASPECT[aspect_key]
    wf['47']['inputs']['seed'] = seed
    for n in ('89', '85:82', '74:71'):
        wf[n]['inputs']['seed'] = seed
    wf['91']['inputs']['custom_path'] = OUTDIR
    wf['91']['inputs']['filename_prefix'] = prefix
    # Anatomy negative (node 106 ships empty) — cheap insurance against the
    # malformed-limb failure mode on scenes with people.
    wf['106']['inputs']['text'] = (
        'extra arms, extra limbs, extra hands, third arm, floating limb, detached limb, '
        'disconnected arm, misplaced arm, deformed hands, mangled hands, fused limbs, '
        'malformed anatomy, distorted body, bad proportions, text, letters, watermark')
    return wf


def main():
    jobs = []
    for spec in sys.argv[1:]:
        parts = spec.split(':')
        prefix, aspect_key, pf = parts[0], parts[1], parts[2]
        seed = int(parts[3]) if len(parts) > 3 else random.randint(1, 2**40)
        jobs.append((prefix, aspect_key, pf, seed))

    before = set(os.listdir(OUTDIR))
    pids = []
    for prefix, ak, pf, seed in jobs:
        wf = build(prefix, ak, pf, seed)
        body = json.dumps({'prompt': wf}).encode('utf-8')
        req = urllib.request.Request(COMFY + '/prompt', data=body,
                                     headers={'Content-Type': 'application/json'}, method='POST')
        try:
            with urllib.request.urlopen(req) as r:
                res = json.load(r)
        except urllib.error.HTTPError as e:
            print(f'{prefix}: QUEUE FAILED', e.read().decode('utf-8')[:800])
            return 1
        if res.get('node_errors'):
            print(f'{prefix}: NODE ERRORS', json.dumps(res['node_errors'])[:800])
            return 1
        pids.append((prefix, res['prompt_id'], seed))
        print(f'queued {prefix}  seed={seed}', flush=True)

    start = time.time()
    pending = {p for _, p, _ in pids}
    while pending and time.time() - start < 5400:
        time.sleep(15)
        for prefix, pid, seed in pids:
            if pid not in pending:
                continue
            with urllib.request.urlopen(f'{COMFY}/history/{pid}') as r:
                hist = json.load(r)
            if pid in hist:
                st = hist[pid].get('status', {}).get('status_str')
                print(f'  {prefix}: {st}  ({int(time.time()-start)}s)', flush=True)
                pending.discard(pid)
        if pending:
            print(f'  ...{len(pending)} pending  {int(time.time()-start)}s', flush=True)

    print('\nSEEDS:')
    for prefix, pid, seed in pids:
        print(f'  {prefix} = {seed}')
    print('NEW FILES:', sorted(set(os.listdir(OUTDIR)) - before))
    return 0


if __name__ == '__main__':
    sys.exit(main())
