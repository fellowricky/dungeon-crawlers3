/* Optimize a raw generator GLB at several simplify ratios, render every
   variant against the raw mesh, and build a comparison sheet.

     node scripts/model_qa/qa_models.mjs 3d/Grim/WeepingMourner.glb [more.glb ...]
          [--ratios 0.3,0.15,0.08,0.04]

   Output: scratch/model_qa/<name>/sheet.png + metrics.json (+ the variant GLBs).
   Look at the sheet, pick the lowest ratio that still reads right, then ship it:

     node scripts/model_qa/qa_models.mjs 3d/Grim/WeepingMourner.glb --ship r0.08

   which copies that variant to 3d/Grim/WeepingMourner.opt.glb and to
   public/3d/Grim/WeepingMourner.opt.glb (the copy the game loads). */
import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BLENDER = 'C:\\Program Files\\Blender Foundation\\Blender 4.5\\blender.exe';
const HERE = path.dirname(new URL(import.meta.url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
const ROOT = path.resolve(HERE, '../..');
/* the same flags scripts/optimize_new_glbs.mjs ships with, ratio aside */
const BASE_FLAGS = '--compress draco --texture-compress webp --texture-size 1024';

const args = process.argv.slice(2);
const flag = name => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
};
const ratios = (flag('--ratios') || '0.3,0.15,0.08,0.04').split(',').map(Number);
const ship = flag('--ship');
if (!args.length) {
  console.error('usage: node scripts/model_qa/qa_models.mjs <raw.glb> [...] [--ratios a,b,c] [--ship <label>]');
  process.exit(1);
}

function glbStats(file) {
  const b = fs.readFileSync(file);
  const len = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + len).toString());
  let tris = 0;
  for (const m of j.meshes || []) for (const p of m.primitives) {
    const acc = p.indices != null ? j.accessors[p.indices] : j.accessors[p.attributes.POSITION];
    tris += acc.count / 3;
  }
  return { tris: Math.round(tris), kb: Math.round(b.length / 1024) };
}

function optimize(input, output, ratio) {
  const simplify = ratio === null ? '--simplify false' : `--simplify-ratio ${ratio} --simplify-error 0.1`;
  execSync(`npx --yes @gltf-transform/cli optimize "${input}" "${output}" ${BASE_FLAGS} ${simplify}`,
    { stdio: ['ignore', 'ignore', 'inherit'] });
}

for (const rel of args) {
  const raw = path.resolve(ROOT, rel);
  const name = path.basename(raw, '.glb');
  const outDir = path.join(ROOT, 'scratch', 'model_qa', name);
  const varDir = path.join(outDir, 'variants');

  if (ship) {
    const src = path.join(varDir, `${ship}.opt.glb`);
    if (!fs.existsSync(src)) { console.error(`no variant ${src}; run the QA pass first`); process.exit(1); }
    const destRaw = raw.replace(/\.glb$/, '.opt.glb');
    const relToRoot = path.relative(ROOT, destRaw);
    const destPublic = path.join(ROOT, 'public', relToRoot);
    fs.mkdirSync(path.dirname(destPublic), { recursive: true });
    fs.copyFileSync(src, destRaw);
    fs.copyFileSync(src, destPublic);
    const s = glbStats(src);
    console.log(`shipped ${name} ${ship}: ${s.tris.toLocaleString()} tris, ${s.kb} KB -> ${relToRoot} + public/${relToRoot}`);
    continue;
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(varDir, { recursive: true });
  const variants = [{ label: 'raw', file: raw }];
  const jobs = [['tex-only', null], ...ratios.map(r => [`r${r}`, r])];
  for (const [label, ratio] of jobs) {
    const file = path.join(varDir, `${label}.opt.glb`);
    process.stdout.write(`${name}: optimizing ${label}... `);
    optimize(raw, file, ratio);
    console.log('done');
    variants.push({ label, file });
  }

  const stats = variants.map(v => ({ label: v.label, ...glbStats(v.file) }));
  fs.writeFileSync(path.join(outDir, 'stats.json'), JSON.stringify(stats, null, 2));

  console.log(`${name}: rendering ${variants.length} variants in Blender...`);
  const pairs = variants.map(v => `"${v.label}=${v.file}"`).join(' ');
  execSync(`"${BLENDER}" --background --python "${path.join(HERE, 'render_variants.py')}" -- "${outDir}" ${pairs}`,
    { stdio: ['ignore', 'ignore', 'inherit'] });

  const out = execSync(`python "${path.join(HERE, 'compare_variants.py')}" "${outDir}" "${path.join(outDir, 'stats.json')}"`).toString();
  console.log(`\n${name}`);
  console.log('variant    tris        KB     min IoU  max shade');
  for (const m of JSON.parse(out.trim().split('\n').pop())) {
    const iou = m.label === 'raw' ? '' : m.min_iou.toFixed(3);
    const sh = m.label === 'raw' ? '' : m.max_shade.toFixed(1);
    console.log(`${m.label.padEnd(10)} ${String(m.tris).padStart(9)} ${String(m.kb).padStart(9)}   ${iou.padStart(7)}  ${sh.padStart(9)}`);
  }
  console.log(`sheet: ${path.relative(ROOT, path.join(outDir, 'sheet.png'))}`);
}
