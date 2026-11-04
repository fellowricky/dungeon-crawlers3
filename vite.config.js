import { defineConfig } from 'vite';
import fs from 'fs';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function saveMonstersPlugin() {
  return {
    name: 'save-monsters-plugin',
    configureServer(server) {
      /* Guild compound layout editing: the preview writes per-LEVEL position
         and scale nudges straight into the art manifest, so tuning a building's
         placement survives a reload instead of living in one browser tab.
         Merged rather than replaced — a partial edit must not wipe levels that
         were not touched this session. */
      server.middlewares.use('/api/save-guild-transforms', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const patch = JSON.parse(body);
            const mPath = path.resolve(__dirname, 'public/art/guild/manifest.json');
            const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
            let count = 0;

            /* Per-LEVEL art offsets live on the tier entries. */
            for (const [id, levels] of Object.entries(patch.transforms || {})) {
              const entry = manifest[id];
              if (!entry || !Array.isArray(entry.tiers)) continue;
              for (const [lvl, t] of Object.entries(levels)) {
                const i = Math.max(1, Math.min(entry.tiers.length, parseInt(lvl, 10))) - 1;
                const tier = entry.tiers[i];
                if (!tier || typeof tier !== 'object') continue;
                tier.dx = t.dx; tier.dz = t.dz; tier.scale = t.scale;
                count++;
              }
            }

            /* The click volume is per BUILDING and deliberately NOT per level —
               it describes the plot, so it must not move when a level's art is
               nudged. Stored on the building entry, not the tier. */
            for (const [id, hb] of Object.entries(patch.hitboxes || {})) {
              if (!manifest[id]) continue;
              manifest[id].hitbox = hb;
              count++;
            }
            fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, count }));
          } catch (err) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });

      server.middlewares.use('/api/save-monsters', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/monsters.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved monsters.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });

      server.middlewares.use('/api/upload-sprite', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const { filename, dataUrl } = JSON.parse(body);
              const base64Data = dataUrl.replace(/^data:image\/\w+;base64,/, '');
              const buffer = Buffer.from(base64Data, 'base64');
              const targetDir = path.resolve(__dirname, 'public/sprites');
              if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
              const cleanName = filename.replace(/[^a-zA-Z0-9_.-]/g, '_');
              const targetPath = path.join(targetDir, cleanName);
              fs.writeFileSync(targetPath, buffer);
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, spritePath: `sprites/${cleanName}` }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Loot editor "Save to project" for the budget/cost tuning. Mirrors
         /api/save-items so a balance pass can be committed straight from the
         editor instead of round-tripping a downloaded file by hand. */
      server.middlewares.use('/api/save-loot-budget', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/loot_budget.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved loot_budget.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* World map biome painter (world_map_editor.html) writes the painted
         cell grid back into the source. The shape is checked first: a short
         row or an unknown letter would shift every biome lookup after it. */
      server.middlewares.use('/api/save-world-biomes', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          res.setHeader('Content-Type', 'application/json');
          try {
            const data = JSON.parse(body);
            const { cols, rows, legend, cells } = data;
            if (!Array.isArray(cells) || cells.length !== rows) throw new Error(`expected ${rows} rows, got ${cells?.length}`);
            cells.forEach((row, r) => {
              if (typeof row !== 'string' || row.length !== cols) throw new Error(`row ${r} is not ${cols} cells`);
              for (const ch of row) if (!(ch in legend)) throw new Error(`row ${r} has unknown cell '${ch}'`);
            });
            fs.writeFileSync(path.resolve(__dirname, 'src/game/world_biomes.json'), JSON.stringify(data, null, 2) + '\n', 'utf8');
            res.end(JSON.stringify({ success: true }));
          } catch (err) {
            res.statusCode = 400;
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        });
      });
      /* Bestiary "CR Scaling" tab writes the monster difficulty levers straight
         back into the source table so a tuning pass survives a page reload. */
      server.middlewares.use('/api/save-cr-scaling', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/cr_scaling.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved cr_scaling.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Bestiary "Spawn Budget" tab writes the encounter-density levers (room
         threat budget + per-tier monster costs) the dungeon generator reads. */
      server.middlewares.use('/api/save-spawn-budget', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/spawn_budget.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved spawn_budget.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Bestiary "Boss Encounters" tab — the 100 curated theme x level finales
         the final floor of every generated quest spawns. */
      server.middlewares.use('/api/save-bosses', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/boss_encounters.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved boss_encounters.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Bestiary "Story Quests" tab — per-mission curated cast overrides (floor
         mob pools, fallback roster, final boss + escorts). Keyed by mission id
         and merged over the authored STORY_MISSIONS literals in story.js. */
      server.middlewares.use('/api/save-story-encounters', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/story_encounters.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved story_encounters.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Bestiary "Special Rooms" tab — curated monster lists for tactical room
         styles (Infestation, Nest, Ritual, etc.) by dungeon theme and level. */
      server.middlewares.use('/api/save-tactical-rooms', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/tactical_rooms.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved tactical_rooms.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Bestiary "Spawn Budget" tab — per-room spawn threat budget, cost curves,
         and level curve. */
      server.middlewares.use('/api/save-spawn-budget', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/spawn_budget.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved spawn_budget.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
      /* Sound editor "Save to project" — writes the slot/ability registry that
         audio.js imports, so an audio pass survives a page reload. */
      server.middlewares.use('/api/save-sounds', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/sounds.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved sounds.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });

      /* VFX animation editor "Save to project" — writes the composite animation
         registry (vfx_animations.json) that vfx_animations.js imports, so an
         effect pass survives a page reload and plays in-game immediately. */
      server.middlewares.use('/api/save-vfx-anims', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/vfx_animations.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved vfx_animations.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });

      /* Audio library for the sound editor's file picker. Walks public/sounds
         so the picker browses what is actually on disk — that's also how the
         editor spots orphaned files no slot references. */
      server.middlewares.use('/api/list-sounds', (req, res) => {
        try {
          const root = path.resolve(__dirname, 'public/sounds');
          const out = [];
          const walk = (abs, rel) => {
            if (!fs.existsSync(abs)) return;
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              const childRel = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
              else if (/\.(wav|mp3|ogg|flac)$/i.test(entry.name)) {
                out.push({ path: childRel, size: fs.statSync(path.join(abs, entry.name)).size });
              }
            }
          };
          walk(root, '');
          out.sort((a, b) => a.path.localeCompare(b.path));
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, files: out }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      /* Icon library for the loot editor's picker. Walks the shipped DCSS item
         tiles plus any custom uploads so the picker browses everything that
         actually exists on disk instead of a hand-maintained shortlist. */
      server.middlewares.use('/api/list-icons', (req, res) => {
        try {
          const roots = ['public/dcss/item', 'public/sprites'];
          const out = [];
          const walk = (abs, rel) => {
            if (!fs.existsSync(abs)) return;
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              const childRel = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
              else if (/\.(png|gif|webp)$/i.test(entry.name)) out.push(childRel);
            }
          };
          for (const root of roots) {
            walk(path.resolve(__dirname, root), root.replace(/^public\//, ''));
          }
          out.sort();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, icons: out }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      /* Sprite-sheet library for the bestiary's sprite fields & animated-sprite
         atlas picker. Walks the custom uploads (public/sprites) plus the DCSS
         monster art so paths are filled from a visual picker, not typed. */
      server.middlewares.use('/api/list-sprite-sheets', (req, res) => {
        try {
          const roots = ['public/sprites', 'public/dcss/monster'];
          const out = [];
          const walk = (abs, rel) => {
            if (!fs.existsSync(abs)) return;
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              const childRel = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
              else if (/\.(png|gif|webp)$/i.test(entry.name)) out.push(childRel);
            }
          };
          for (const root of roots) {
            walk(path.resolve(__dirname, root), root.replace(/^public\//, ''));
          }
          out.sort();
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: true, files: out }));
        } catch (err) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: err.message }));
        }
      });
      /* ---- dungeon editor (dungeon_editor.html) ---- */
      const readBody = (req) => new Promise((resolve, reject) => {
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
      });
      const sendJson = (res, code, obj) => {
        res.statusCode = code;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(obj));
      };

      /* Theme tuning layer merged over THEMES in dungeon_generator.js. */
      server.middlewares.use('/api/save-theme-overrides', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const data = await readBody(req);
          const targetPath = path.resolve(__dirname, 'src/game/theme_overrides.json');
          fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
          sendJson(res, 200, { success: true, message: 'Saved theme_overrides.json' });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Source tiles for the editor's texture picker: the DCSS families on disk,
         grouped by name so the picker offers "family + which four variants". */
      server.middlewares.use('/api/list-tile-sources', (req, res) => {
        try {
          const roots = {
            floor: path.resolve(__dirname, 'Sprites/Dungeon Crawl Stone Soup Full/dungeon/floor'),
            wall: path.resolve(__dirname, 'Sprites/Dungeon Crawl Stone Soup Full/dungeon/wall'),
            custom: path.resolve(__dirname, 'Sprites/custom_tiles')
          };
          const out = {};
          for (const kind of ['floor', 'wall', 'custom']) {
            const dir = roots[kind];
            if (!fs.existsSync(dir)) continue;
            const fams = {};
            const walk = (abs, prefix) => {
              for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
                if (entry.isDirectory()) { walk(path.join(abs, entry.name), `${prefix}${entry.name}/`); continue; }
                const m = /^(.+)_(\d+)\.png$/.exec(entry.name);
                if (!m) continue;
                const fam = prefix + m[1];
                (fams[fam] ||= []).push(Number(m[2]));
              }
            };
            walk(dir, '');
            for (const fam of Object.keys(fams)) {
              const variants = fams[fam].sort((a, b) => a - b);
              if (variants.length >= 4 || kind === 'custom') out[`${kind}/${fam}`] = variants;
            }
          }
          sendJson(res, 200, { success: true, families: out });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Raw source tile bytes for the in-browser baker. Restricted to the DCSS
         tree so the editor can't be used to read arbitrary files off disk. */
      server.middlewares.use('/api/tile-source', (req, res) => {
        try {
          const url = new URL(req.url, 'http://localhost');
          const rel = url.searchParams.get('path') || '';
          if (!/^(floor|wall|custom)\/[\w\-/]+_\d+\.png$/.test(rel)) { res.statusCode = 400; return res.end('Bad path'); }
          const abs = rel.startsWith('custom/')
            ? path.resolve(__dirname, 'Sprites/custom_tiles', rel.slice('custom/'.length))
            : path.resolve(__dirname, 'Sprites/Dungeon Crawl Stone Soup Full/dungeon', rel);
          if (!fs.existsSync(abs)) { res.statusCode = 404; return res.end('Not found'); }
          res.statusCode = 200;
          res.setHeader('Content-Type', 'image/png');
          res.end(fs.readFileSync(abs));
        } catch (err) { res.statusCode = 500; res.end(err.message); }
      });

      /* Imported source tiles: user PNGs saved alongside the DCSS set as their
         own family, so they show up in the picker and bake identically. */
      server.middlewares.use('/api/upload-tile-source', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const { family, index, dataUrl } = await readBody(req);
          if (!/^[\w-]+$/.test(family || '')) throw new Error('bad family name');
          const dir = path.resolve(__dirname, 'Sprites/custom_tiles');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const file = `${family}_${Number(index) | 0}.png`;
          fs.writeFileSync(path.join(dir, file),
            Buffer.from(String(dataUrl).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
          sendJson(res, 200, { success: true, family: `custom/${family}`, file });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Imported 3D scatter models. */
      server.middlewares.use('/api/upload-model', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const { name, dataUrl } = await readBody(req);
          if (!/^[\w-]+\.(glb|gltf)$/i.test(name || '')) throw new Error('need a .glb or .gltf name');
          const dir = path.resolve(__dirname, 'public/3d/Custom');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, name),
            Buffer.from(String(dataUrl).replace(/^data:[^;]+;base64,/, ''), 'base64'));
          sendJson(res, 200, { success: true, url: `/3d/Custom/${name}` });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Registry of imported models, merged into the prop tables at import. */
      server.middlewares.use('/api/save-custom-props', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const data = await readBody(req);
          const targetPath = path.resolve(__dirname, 'src/game/custom_props.json');
          fs.writeFileSync(targetPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
          sendJson(res, 200, { success: true, message: 'Saved custom_props.json' });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Every GLB on disk, so the editor can attach an existing model to a
         theme without re-uploading it. */
      server.middlewares.use('/api/list-models', (req, res) => {
        try {
          const root = path.resolve(__dirname, 'public/3d');
          const out = [];
          const walk = (abs, rel) => {
            if (!fs.existsSync(abs)) return;
            for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
              const childRel = rel ? `${rel}/${entry.name}` : entry.name;
              if (entry.isDirectory()) walk(path.join(abs, entry.name), childRel);
              else if (/\.(glb|gltf)$/i.test(entry.name)) out.push(childRel);
            }
          };
          walk(root, '');
          out.sort();
          sendJson(res, 200, { success: true, models: out });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* Baked atlas + bump PNGs straight into public/art/tiles. */
      server.middlewares.use('/api/save-tile-atlas', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const { name, dataUrl, bumpDataUrl } = await readBody(req);
          if (!/^[\w-]+\.png$/.test(name || '')) throw new Error('bad atlas name');
          const dir = path.resolve(__dirname, 'public/art/tiles');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const write = (file, url) => fs.writeFileSync(path.join(dir, file),
            Buffer.from(String(url).replace(/^data:image\/\w+;base64,/, ''), 'base64'));
          write(name, dataUrl);
          if (bumpDataUrl) write(name.replace(/\.png$/, '_bump.png'), bumpDataUrl);
          sendJson(res, 200, { success: true, path: `art/tiles/${name}` });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      /* ---- trailer rig: direct-to-video encode ----
         Frames are piped straight into ffmpeg's stdin and never touch disk as
         images. A 42s 1080p tour is ~5.6 GB as PNG frames and a few tens of MB
         as H.264, so this is the default path; the PNG dump below is kept for
         when individual stills are actually wanted. */
      const encoders = new Map();

      /* Is NVENC usable? Present in `-encoders` does not mean it will actually
         run (driver, permissions, a busy card), so probe it once for real and
         cache the answer. Costs a few hundred ms on the first render.
         The probe frame must clear NVENC's minimum dimensions — 64x64 is
         rejected outright with "Frame Dimension less than the minimum
         supported value", which reads exactly like "no GPU encoder". */
      let _nvenc = null;
      const nvencAvailable = () => {
        if (_nvenc !== null) return Promise.resolve(_nvenc);
        return new Promise(resolve => {
          let done = false;
          const finish = ok => { if (!done) { done = true; _nvenc = ok; resolve(ok); } };
          try {
            const probe = spawn('ffmpeg', ['-hide_banner', '-f', 'lavfi',
              '-i', 'nullsrc=s=256x256:d=0.1', '-c:v', 'h264_nvenc', '-f', 'null', '-'],
              { stdio: 'ignore' });
            probe.on('close', code => finish(code === 0));
            probe.on('error', () => finish(false));
            setTimeout(() => { try { probe.kill(); } catch {} finish(false); }, 8000);
          } catch { finish(false); }
        });
      };

      server.middlewares.use('/api/trailer-encode', async (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        const url = new URL(req.url, 'http://localhost');
        const action = url.pathname.replace(/^\//, '') || '';
        const shot = url.searchParams.get('shot') || 'shot';
        if (!/^[\w-]+$/.test(shot)) return sendJson(res, 400, { success: false, error: 'bad shot name' });

        if (action === 'start') {
          const fps = Number(url.searchParams.get('fps')) || 30;
          const crf = Number(url.searchParams.get('crf')) || 18;
          const vflip = url.searchParams.get('vflip') === '1';
          const outW = Number(url.searchParams.get('w')) || 0;
          const outH = Number(url.searchParams.get('h')) || 0;
          const hw = url.searchParams.get('hw') !== '0' && await nvencAvailable();
          const dir = path.resolve(__dirname, 'trailer_out');
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const out = path.join(dir, `${shot}.mp4`);

          const old = encoders.get(shot);
          if (old) { try { old.proc.kill(); } catch {} encoders.delete(shot); }

          let proc;
          try {
            const codec = hw
              /* NVENC: the encode moves off the CPU entirely, which matters
                 because the browser needs every core it can get to produce
                 frames in the first place. -cq with -b:v 0 is NVENC's
                 constant-quality mode, the analogue of x264's -crf. */
              ? ['-c:v', 'h264_nvenc', '-preset', 'p5', '-tune', 'hq',
                 '-rc', 'vbr', '-cq', String(crf), '-b:v', '0']
              : ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(crf)];
            proc = spawn('ffmpeg', [
              '-y', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-',
              /* One filter chain: right the GL-order frame, then downscale a
                 supersampled render to delivery size with lanczos. */
              ...((() => {
                const vf = [];
                if (vflip) vf.push('vflip');
                if (outW && outH) vf.push(`scale=${outW}:${outH}:flags=lanczos`);
                return vf.length ? ['-vf', vf.join(',')] : [];
              })()),
              ...codec,
              '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out
            ], { stdio: ['pipe', 'ignore', 'pipe'] });
          } catch (err) {
            return sendJson(res, 500, { success: false, error: `ffmpeg not runnable: ${err.message}` });
          }

          const rec = { proc, out, frames: 0, stderr: '', failed: null, hw };
          proc.stderr.on('data', c => { rec.stderr = (rec.stderr + c).slice(-4000); });
          proc.on('error', err => { rec.failed = err.message; });
          proc.stdin.on('error', () => { /* reported via the exit code on finish */ });
          encoders.set(shot, rec);
          return sendJson(res, 200, { success: true, out: `trailer_out/${shot}.mp4`,
                                      encoder: hw ? 'h264_nvenc (GPU)' : 'libx264 (CPU)' });
        }

        const rec = encoders.get(shot);
        if (!rec) return sendJson(res, 400, { success: false, error: 'no encode in progress' });

        if (action === 'frame') {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            if (rec.failed) return sendJson(res, 500, { success: false, error: rec.failed });
            const buf = Buffer.concat(chunks);
            rec.frames++;
            /* Respond only once ffmpeg has taken the bytes, so a slow encoder
               applies backpressure to the browser instead of ballooning here. */
            const ok = rec.proc.stdin.write(buf);
            if (ok) sendJson(res, 200, { success: true, frames: rec.frames });
            else rec.proc.stdin.once('drain', () => sendJson(res, 200, { success: true, frames: rec.frames }));
          });
          return;
        }

        if (action === 'finish') {
          rec.proc.stdin.end();
          rec.proc.on('close', code => {
            encoders.delete(shot);
            const size = fs.existsSync(rec.out) ? fs.statSync(rec.out).size : 0;
            if (code === 0) {
              sendJson(res, 200, { success: true, out: `trailer_out/${shot}.mp4`,
                                   frames: rec.frames, bytes: size,
                                   encoder: rec.hw ? 'h264_nvenc (GPU)' : 'libx264 (CPU)' });
            } else {
              sendJson(res, 500, { success: false, error: `ffmpeg exited ${code}`,
                                   detail: rec.stderr.slice(-400) });
            }
          });
          return;
        }

        return sendJson(res, 404, { success: false, error: `unknown action "${action}"` });
      });

      /* ---- trailer rig (trailer.html) ---- */
      /* Numbered PNG frames straight to disk. The rig renders offline on a
         fixed timestep, so frames arrive as fast as the machine manages and
         wall clock never touches the output; ffmpeg reassembles them at the
         shot's real fps. */
      server.middlewares.use('/api/trailer-frame', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        try {
          const url = new URL(req.url, 'http://localhost');
          const shot = url.searchParams.get('shot') || 'shot';
          const name = url.searchParams.get('name') || '';
          if (!/^[\w-]+$/.test(shot)) throw new Error('bad shot name');
          if (!/^[\w-]+\.png$/.test(name)) throw new Error('bad frame name');
          const dir = path.resolve(__dirname, 'trailer_out', shot);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            try {
              fs.writeFileSync(path.join(dir, name), Buffer.concat(chunks));
              sendJson(res, 200, { success: true });
            } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
          });
        } catch (err) { sendJson(res, 500, { success: false, error: err.message }); }
      });

      server.middlewares.use('/api/save-items', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', () => {
            try {
              const data = JSON.parse(body);
              const targetPath = path.resolve(__dirname, 'src/game/items.json');
              fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: true, message: 'Saved items.json successfully' }));
            } catch (err) {
              res.statusCode = 500;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: err.message }));
            }
          });
        } else {
          res.statusCode = 405;
          res.end('Method Not Allowed');
        }
      });
    }
  };
}

// Single-page Vite app. `base: './'` makes the production build path-relative, so
// the contents of `dist/` can be dropped onto any static host (Netlify, GitHub
// Pages, itch.io, a plain folder) and just work — no server config required.
/* Icon forge review tool: the picker POSTs the chosen variant (or a regenerate
   flag) per icon. Kept server-side rather than in localStorage on purpose --
   the bestiary editor's saved-state shadowing has bitten us before, and these
   picks drive an overnight generation run. Merged, never replaced, so a partial
   review session does not wipe earlier decisions. */
function iconPicksPlugin() {
  return {
    name: 'icon-picks-plugin',
    configureServer(server) {
      const picksPath = path.resolve(__dirname, 'tools/icon_forge/picks.json');
      const read = () => {
        try { return JSON.parse(fs.readFileSync(picksPath, 'utf8')); }
        catch { return {}; }
      };
      server.middlewares.use('/api/icon-picks', (req, res) => {
        if (req.method === 'GET') {
          res.setHeader('Content-Type', 'application/json');
          return res.end(JSON.stringify(read()));
        }
        if (req.method !== 'POST') { res.statusCode = 405; return res.end('Method Not Allowed'); }
        let body = '';
        req.on('data', c => { body += c; });
        req.on('end', () => {
          try {
            const patch = JSON.parse(body);
            const picks = read();
            for (const [id, v] of Object.entries(patch)) {
              if (v === null) delete picks[id]; else picks[id] = v;
            }
            fs.writeFileSync(picksPath, JSON.stringify(picks, null, 1));
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: true, count: Object.keys(picks).length }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ ok: false, error: String(e.message) }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [saveMonstersPlugin(), iconPicksPlugin()],
  base: './',
  // Honor the PORT env var so preview harnesses with auto-assigned ports work.
  server: process.env.PORT ? { port: Number(process.env.PORT), strictPort: true } : {},
  build: {
    target: 'es2020',
    outDir: 'dist',
  },
  // The lpc_repo checkout has its own HTML/TS entries that break vite's
  // dependency scan (and skip pre-bundling → slow first load). Only scan
  // the game's real entry point.
  optimizeDeps: {
    entries: ['index.html'],
  },
  test: {
    include: ['test/**/*.test.js'],
    testTimeout: 15000,
  },
});
