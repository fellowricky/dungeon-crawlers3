import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const files = [
  { in: '3d/generic/chest.glb', out: '3d/generic/chest.opt.glb' },
  { in: '3d/generic/barrel.glb', out: '3d/generic/barrel.opt.glb' },
  { in: '3d/generic/crate.glb', out: '3d/generic/crate.opt.glb' },
  { in: '3d/generic/oldweaponrack.glb', out: '3d/generic/oldweaponrack.opt.glb' },
  { in: '3d/Ancient/cage.glb', out: '3d/Ancient/cage.opt.glb' },
  { in: '3d/Ancient/cage2.glb', out: '3d/Ancient/cage2.opt.glb' },
  { in: '3d/Ancient/throne.glb', out: '3d/Ancient/throne.opt.glb' },
];

console.log('Starting GLB optimization...');
for (const item of files) {
  if (!fs.existsSync(item.in)) {
    console.log(`Skipping missing file: ${item.in}`);
    continue;
  }
  const rawSize = (fs.statSync(item.in).size / (1024 * 1024)).toFixed(2);
  console.log(`\nOptimizing ${item.in} (${rawSize} MB)...`);
  const t0 = Date.now();
  try {
    const cmd = `npx @gltf-transform/cli optimize "${item.in}" "${item.out}" --compress draco --texture-compress webp --texture-size 1024 --simplify-ratio 0.08 --simplify-error 0.1`;
    execSync(cmd, { stdio: 'inherit', shell: 'cmd.exe' });
    const optSize = (fs.statSync(item.out).size / 1024).toFixed(1);
    console.log(`✓ ${item.out}: ${optSize} KB in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  } catch (err) {
    console.error(`Failed to optimize ${item.in}:`, err.message);
  }
}
console.log('\nAll optimizations finished!');
