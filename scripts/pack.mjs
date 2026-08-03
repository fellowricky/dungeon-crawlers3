/**
 * Packages the game for playtesters (Windows x64, unpacked folder).
 *
 * The default electron-packager flow is a blocklist, which quietly ships every
 * new dev folder someone adds. This is an allowlist instead: only the files the
 * shipped app actually loads at runtime end up in resources/app.
 *
 *   node scripts/pack.mjs           -> release/Dungeon Crawlers V<major.minor>-win32-x64
 *
 * Run `npm run build` first — this script refuses to pack a missing dist/.
 */
import { packager } from '@electron/packager';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const shortVersion = pkg.version.split('.').slice(0, 2).join('.');   // 0.2.0 -> 0.2
const appName = `Dungeon Crawlers V${shortVersion}`;

if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) {
  console.error('dist/index.html not found — run `npm run build` before packing.');
  process.exit(1);
}

// Everything the packaged app needs, and nothing else. Anything at the repo
// root that is not listed here (editors, sims, tests, Sprites/, lpc_repo/,
// scratch/, backups, node_modules/, .git/) is left out of the build.
const KEEP = new Set([
  'dist',              // the built game: code + assets
  'electron',          // the shell (main.cjs); smoke.cjs is filtered below
  'package.json',      // electron reads "main" from here
  'LICENSE',
  'CREDITS.md',        // asset attribution — required by the third-party licenses
]);

function ignore(relPath) {
  if (relPath === '') return false;                 // the root itself
  const parts = relPath.split(/[\\/]/).filter(Boolean);
  if (!KEEP.has(parts[0])) return true;
  // Dev-only harness that lives beside the shell entry point.
  if (parts[0] === 'electron' && parts[1] === 'smoke.cjs') return true;
  return false;
}

const [out] = await packager({
  dir: ROOT,
  name: appName,
  platform: 'win32',
  arch: 'x64',
  out: path.join(ROOT, 'release'),
  overwrite: true,
  asar: false,
  appVersion: pkg.version,
  appCopyright: 'MIT — see LICENSE and CREDITS.md',
  win32metadata: {
    CompanyName: 'Zenu',
    FileDescription: 'Dungeon Crawlers',
    ProductName: 'Dungeon Crawlers',
  },
  ignore,
  prune: true,
});

console.log(`\nPacked to: ${out}`);
console.log(`Run: "${path.join(out, appName + '.exe')}"`);
