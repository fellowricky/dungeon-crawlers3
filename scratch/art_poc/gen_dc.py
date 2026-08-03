"""Queue a DC-pixel.json job against the local ComfyUI and wait for the result.

Usage:  python gen_dc.py <prefix> <aspect_key> <prompt_file> [seed]

aspect_key is a short alias mapped to FluxResolutionNode's option strings.
Runs the workflow in pure txt2img mode (the img2img LoadImage branch is
detached from the payload so a missing input image can't fail validation).
"""
import json, sys, time, random, urllib.request, os

COMFY = 'http://192.168.2.19:8188'
WORKFLOW = r'G:\ClaudesFolder\data\custom_workflows\DC-pixel.json'
OUTDIR = r'G:\ClaudesFolder\dungeon-crawlers\scratch\art_poc'

ASPECT = {
    'pano':   '16:9 (Panorama)',
    'cine':   '8:5 (Cinematic View)',
    'wide':   '3:2 (Golden Landscape)',
    'land':   '4:3 (Classic Landscape)',
    'square': '1:1 (Perfect Square)',
    'port':   '3:4 (Golden Ratio)',
}

STYLE_HEAD = ("Desimulate, Modern hi-bit pixel art scene in a dynamic cinematic "
              "composition with dark fantasy grunge aesthetic. ")
STYLE_TAIL = ("\n\nHi-bit pixel art style with clean sprites, detailed shading, rich but "
              "darker color gradients and cinematic framing. Gritty dark fantasy aesthetic "
              "with weathered textures, battle damage, smoke, and atmospheric gloom. "
              "No watermarks, no borders, no text, pure pixel art illustration.")


def main():
    prefix, aspect_key, prompt_file = sys.argv[1], sys.argv[2], sys.argv[3]
    seed = int(sys.argv[4]) if len(sys.argv) > 4 else random.randint(1, 2**40)

    with open(prompt_file, 'r', encoding='utf-8') as f:
        scene = f.read().strip()
    prompt = STYLE_HEAD + scene + STYLE_TAIL

    with open(WORKFLOW, 'r', encoding='utf-8') as f:
        wf = json.load(f)

    # txt2img: point the sampler straight at the empty latent, drop the img2img branch
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

    body = json.dumps({'prompt': wf}).encode('utf-8')
    req = urllib.request.Request(COMFY + '/prompt', data=body,
                                 headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req) as r:
            res = json.load(r)
    except urllib.error.HTTPError as e:
        print('QUEUE FAILED:', e.read().decode('utf-8')[:3000])
        return 1

    pid = res['prompt_id']
    if res.get('node_errors'):
        print('NODE ERRORS:', json.dumps(res['node_errors'])[:2000])
        return 1
    print(f'queued {pid}  seed={seed}  aspect={ASPECT[aspect_key]}', flush=True)

    before = set(os.listdir(OUTDIR)) if os.path.isdir(OUTDIR) else set()
    start = time.time()
    while time.time() - start < 1800:
        time.sleep(10)
        with urllib.request.urlopen(f'{COMFY}/history/{pid}') as r:
            hist = json.load(r)
        if pid in hist:
            st = hist[pid].get('status', {})
            print('status:', st.get('status_str'), 'completed:', st.get('completed'), flush=True)
            if st.get('status_str') == 'error':
                print(json.dumps(hist[pid].get('status'), indent=1)[:3000])
                return 1
            new = sorted(set(os.listdir(OUTDIR)) - before)
            print('NEW FILES:', new)
            print(f'elapsed {int(time.time()-start)}s')
            return 0
        print(f'  ...{int(time.time()-start)}s', flush=True)
    print('TIMEOUT')
    return 1


if __name__ == '__main__':
    sys.exit(main())
