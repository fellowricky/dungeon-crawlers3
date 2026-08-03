# Quick Start: Generate Monster Sprites

## One-Line Version

Generate 10 64x64 pixel-perfect game sprites from a DCSS monster sprite in 15-20 minutes.

## Setup (First Time Only)

1. Verify ComfyUI is running at `http://192.168.2.19:8188` (ask Zenu if down)
2. Copy this script to your workspace:
   ```
   C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad\upscale_ft_pipeline.py
   ```

## To Generate a Monster

### 1. Edit the script

Open `upscale_ft_pipeline.py` and change:

```python
MONSTER_NAME = "goblin"           # Change this
TARGET_SCALE = 64                 # 64 or 256 (64 recommended)
```

And the sprite path:
```python
DCSS_SPRITE = r"G:\ClaudesFolder\dungeon-crawlers\Sprites\Dungeon Crawl Stone Soup Full\monster\goblin.png"
```

### 2. Customize the prompt (optional)

Find this line (~115):
```python
wf["6"]["inputs"]["text"] = "pixpix, 8-bit, pixel_art, masterpiece, best quality, green goblin creature, small humanoid, pointy ears, detailed pixel art, isolated character sprite, white or light gray background, NOT black background, black pixel outline"
```

Change the creature description part:
- For **orc**: "dark green orc warrior, muscular humanoid, tusks, fierce expression, detailed pixel art"
- For **skeleton**: "white bone skeleton, undead warrior, hollow eye sockets, detailed pixel art"
- For **zombie**: "gray decayed zombie, shambling undead, tattered appearance, detailed pixel art"

### 3. Run it

```bash
cd "C:\Users\fello\AppData\Local\Temp\claude\G--ClaudesFolder\9d610141-f80f-4d26-a23f-430222134f6a\scratchpad"
python upscale_ft_pipeline.py
```

### 4. Wait for completion

Takes ~15-20 minutes for 10 variations (ComfyUI generates, pixelfixer downscales)

### 5. Find your sprites

```
G:\ClaudesFolder\dungeon-crawlers\Sprites\dnd_enemies\<monster_name>\final_64\
```

All 10 sprites are 64x64 with black background ready for manual removal.

## Available DCSS Sprites

```
goblin
hobgoblin
orc
skeleton
zombie
ghoul
troll
elf
dwarf
human
```

(and 1500+ others in the Dungeon Crawl Stone Soup sprite pack)

## Output Structure

```
dnd_enemies/
├── <monster>/
│   ├── raw/              ← 512x512 raw AI outputs (keep for reference)
│   └── final_64/         ← 64x64 game sprites (use these)
```

## Common Tasks

### Generate 3 monsters in sequence

```bash
# Edit script for orc, run
python upscale_ft_pipeline.py

# Edit script for skeleton, run
python upscale_ft_pipeline.py

# Edit script for zombie, run
python upscale_ft_pipeline.py
```

### Change output size to 256x256

Edit script:
```python
TARGET_SCALE = 256
```

Output goes to `final_256/` folder instead of `final_64/`

### Test with different denoise value

Edit script (~line 117):
```python
wf["3"]["inputs"]["denoise"] = 0.6  # Try 0.4, 0.6, 0.7, 0.8
```

Lower = closer to original DCSS sprite  
Higher = more stylization from FT LoRA

## Background Removal

Sprites currently have solid black backgrounds.

**Manual removal needed** (use Photoshop, GIMP, or Python):

```python
from PIL import Image

img = Image.open("sprite_64.png").convert("RGBA")
data = img.getdata()
new_data = [(r,g,b,0) if r+g+b<30 else (r,g,b,a) for r,g,b,a in data]
img.putdata(new_data)
img.save("sprite_64_transparent.png")
```

## Full Documentation

See `WORKFLOW_DOCUMENTATION.md` in this folder for complete details on:
- Architecture and pipeline stages
- All parameters explained
- Troubleshooting
- Known limitations
- Quality checklist

## Questions?

Refer to `WORKFLOW_DOCUMENTATION.md` section: **Troubleshooting**
