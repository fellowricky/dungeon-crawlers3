import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function saveMonstersPlugin() {
  return {
    name: 'save-monsters-plugin',
    configureServer(server) {
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
export default defineConfig({
  plugins: [saveMonstersPlugin()],
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
  },
});
