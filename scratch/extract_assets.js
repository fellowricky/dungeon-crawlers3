import fs from 'fs';
import path from 'path';

const SRC = 'g:/ClaudesFolder/dungeon-crawlers/lpc_repo/spritesheets';
const DEST = 'g:/ClaudesFolder/dungeon-crawlers/public/lpc';

const allowedDirs = [
  'body/bodies/male', 'body/bodies/female', 'body/bodies/skeleton', 'body/bodies/zombie',
  'body/bodies/muscular', 'body/bodies/child', 'body/bodies/teen',
  
  // heads and facial features
  'head/heads/human/male', 'head/heads/human/female',
  'head/heads/skeleton/adult', 'head/heads/zombie/adult',
  'head/heads/rat/adult', 'head/heads/alien/adult', 'head/heads/goblin/adult',
  'head/heads/orc/male', 'head/heads/wolf/male', 'head/heads/minotaur/male',
  'head/heads/lizard/male', 'head/heads/troll/adult', 'head/heads/frankenstein/adult',
  
  'eyes/human/adult/default',
  'head/ears/elven/adult',
  
  // Hairstyles
  'hair/bangs/adult', 'hair/braid/adult', 'hair/long/adult', 'hair/page/adult', 'hair/messy1/adult', 'hair/pixie/adult',
  'hair/bob/adult', 'hair/curly_long/bold', 'hair/curly_long/adult', 'hair/dreadlocks_long/adult', 'hair/ponytail/adult', 'hair/spiked/adult',
  'hair/loose/adult', 'hair/swoop/adult', 'hair/parted/adult', 'hair/mop/adult',
  
  // Beards
  'beards/beard/basic', 'beards/beard/medium', 'beards/beard/5oclock_shadow', 'beards/mustache/basic',
  
  // Hats/Helmets
  'hat/cloth/leather_cap/adult', 'hat/headband/thick/adult',
  'hat/magic/large/adult', 'hat/magic/celestial/adult',
  'hat/pirate/tricorne/basic/adult',
  
  // clothes
  'torso/clothes/longsleeve/longsleeve/male', 'torso/clothes/longsleeve/longsleeve/female',
  'torso/clothes/shortsleeve/shortsleeve/male', 'torso/clothes/shortsleeve/shortsleeve/female',
  'torso/clothes/robe/male', 'torso/clothes/robe/female',
  'torso/clothes/shirt/male', 'torso/clothes/shirt/female',
  'torso/jacket/tabard/male', 'torso/jacket/tabard/female',
  
  // armour
  'torso/armour/leather/male', 'torso/armour/leather/female',
  'torso/armour/plate/male', 'torso/armour/plate/female',
  'torso/armour/legion/male', 'torso/armour/legion/female',
  'torso/chainmail/male', 'torso/chainmail/female',
  
  // legs and feet
  'legs/pants/male', 'legs/pants/female',
  'legs/armour/plate/male', 'legs/armour/plate/female',
  'feet/shoes/basic/male', 
  'feet/shoes/basic/thin', 
  'feet/armour/plate/male', 'feet/armour/plate/female',
  'feet/boots/fold/male', 'feet/boots/fold/thin',
  'feet/boots/rimmed/male', 'feet/boots/rimmed/thin',
  'feet/shoes/ghillies/male', 'feet/shoes/ghillies/thin',
  'feet/sandals/male', 'feet/sandals/thin',

  // shoulders / pauldrons
  'shoulders/bauldron/male', 'shoulders/bauldron/thin',
  'shoulders/epaulets/male', 'shoulders/epaulets/thin',
  
  // arms/hands (gloves and gauntlets)
  'arms/hands/gloves/male', 'arms/hands/gloves/thin',
  'arms/armour/plate/male', 'arms/armour/plate/thin',
  'arms/bracers/male', 'arms/bracers/thin',
  'shoulders/legion/male', 'shoulders/legion/female',
  'shoulders/mantal/male', 'shoulders/mantal/thin',
  'shoulders/pauldrons/male', 'shoulders/pauldrons/thin',

  // shields (foreground)
  'shield/kite/male', 'shield/kite/female',
  'shield/round',
  'shield/crusader/fg/male', 'shield/crusader/fg/female'
];

const allowedActions = ['walk', 'slash', 'thrust', 'spellcast', 'shoot', 'hurt', 'idle'];

function copyFiltered(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) {
    console.log('Missing source dir:', srcDir);
    return;
  }
  fs.mkdirSync(destDir, { recursive: true });
  
  // Check for the top-level files (e.g. walk.png)
  for (const action of allowedActions) {
    const file = path.join(srcDir, action + '.png');
    const destFile = path.join(destDir, action + '.png');
    
    if (fs.existsSync(file)) {
      fs.copyFileSync(file, destFile);
    } else {
      // It might be a subdirectory (e.g. walk/teal.png)
      let actionDir = path.join(srcDir, action);
      if (!fs.existsSync(actionDir)) {
        if (action === 'slash') actionDir = path.join(srcDir, 'attack_slash');
        else if (action === 'thrust') actionDir = path.join(srcDir, 'attack_thrust');
      }

      if (fs.existsSync(actionDir) && fs.statSync(actionDir).isDirectory()) {
        const fallbacks = ['teal.png', 'white.png', 'gray.png', 'brown.png', 'black.png'];
        let copied = false;
        for (const fb of fallbacks) {
          const colorFile = path.join(actionDir, fb);
          if (fs.existsSync(colorFile)) {
            fs.copyFileSync(colorFile, destFile);
            copied = true;
            break;
          }
        }
        if (!copied) {
          // just grab the first png we find in there
          const anyFiles = fs.readdirSync(actionDir).filter(f => f.endsWith('.png'));
          if (anyFiles.length > 0) {
            fs.copyFileSync(path.join(actionDir, anyFiles[0]), destFile);
          }
        }
      }
    }
  }
}

for (const dir of allowedDirs) {
  copyFiltered(path.join(SRC, dir), path.join(DEST, dir));
}

// 26 Helmets
const helmets = [
  'armet', 'armet_simple', 'barbarian', 'barbarian_nasal', 'barbarian_viking',
  'barbuta', 'barbuta_simple', 'bascinet', 'bascinet_round', 'close',
  'flattop', 'greathelm', 'horned', 'kettle', 'legion', 'mail',
  'maximus', 'morion', 'nasal', 'norman', 'pointed', 'spangenhelm',
  'spangenhelm_viking', 'sugarloaf', 'sugarloaf_simple', 'xeon'
];

for (const h of helmets) {
  const helmetPath = path.join(SRC, 'hat/helmet', h);
  if (fs.existsSync(path.join(helmetPath, 'male'))) {
    copyFiltered(path.join(helmetPath, 'male'), path.join(DEST, 'hat/helmet', h, 'male'));
    copyFiltered(path.join(helmetPath, 'female'), path.join(DEST, 'hat/helmet', h, 'female'));
  } else if (fs.existsSync(path.join(helmetPath, 'adult'))) {
    copyFiltered(path.join(helmetPath, 'adult'), path.join(DEST, 'hat/helmet', h, 'adult'));
  } else {
    copyFiltered(helmetPath, path.join(DEST, 'hat/helmet', h));
  }
}

// 9 Visors
const visors = [
  'grated', 'grated_narrow', 'horned', 'pigface', 'pigface_raised',
  'round', 'round_raised', 'slit', 'slit_narrow'
];

for (const v of visors) {
  const visorPath = path.join(SRC, 'hat/visor', v);
  if (fs.existsSync(path.join(visorPath, 'adult'))) {
    copyFiltered(path.join(visorPath, 'adult'), path.join(DEST, 'hat/visor', v, 'adult'));
  } else {
    copyFiltered(visorPath, path.join(DEST, 'hat/visor', v));
  }
}

// Custom weapon and background shield mappings
const weaponsMeta = [
  {
    name: 'sword/longsword',
    fg: 'weapon/sword/longsword',
    bg: 'weapon/sword/longsword/universal_behind'
  },
  {
    name: 'sword/dagger',
    fg: 'weapon/sword/dagger',
    bg: 'weapon/sword/dagger/behind'
  },
  {
    name: 'sword/rapier',
    fg: 'weapon/sword/rapier',
    bg: 'weapon/sword/rapier/universal_behind'
  },
  {
    name: 'blunt/mace',
    fg: 'weapon/blunt/mace',
    bg: 'weapon/blunt/mace/universal_behind'
  },
  {
    name: 'polearm/spear',
    fg: 'weapon/polearm/spear/foreground',
    bg: 'weapon/polearm/spear/background'
  },
  {
    name: 'magic/wand',
    fg: 'weapon/magic/simple/foreground',
    bg: 'weapon/magic/simple/background'
  },
  {
    name: 'ranged/bow',
    fg: 'weapon/ranged/bow/normal/universal/foreground',
    bg: 'weapon/ranged/bow/normal/universal/background',
    walkFg: 'weapon/ranged/bow/normal/walk/foreground.png',
    walkBg: 'weapon/ranged/bow/normal/walk/background.png'
  }
];

const weaponActions = {
  walk: ['walk', 'walk.png'],
  slash: ['attack_slash', 'slash.png'],
  thrust: ['attack_thrust', 'thrust.png'],
  spellcast: ['spellcast', 'spellcast.png'],
  shoot: ['shoot', 'shoot.png'],
  hurt: ['hurt', 'hurt.png']
};

for (const w of weaponsMeta) {
  const fgDestDir = path.join(DEST, 'weapon', w.name);
  const bgDestDir = path.join(DEST, 'weapon_behind', w.name);
  
  fs.mkdirSync(fgDestDir, { recursive: true });
  fs.mkdirSync(bgDestDir, { recursive: true });
  
  for (const actKey in weaponActions) {
    const [subDir, fileName] = weaponActions[actKey];
    
    // 1. Resolve foreground source
    let fgSrc = null;
    if (actKey === 'walk' && w.walkFg) {
      fgSrc = path.join(SRC, w.walkFg);
    } else {
      const dirPath = path.join(SRC, w.fg, subDir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.png'));
        if (files.length > 0) fgSrc = path.join(dirPath, files[0]);
      } else {
        const altDir = actKey === 'slash' ? 'slash' : (actKey === 'thrust' ? 'thrust' : '');
        if (altDir) {
          const altPath = path.join(SRC, w.fg, altDir);
          if (fs.existsSync(altPath)) {
            const files = fs.readdirSync(altPath).filter(f => f.endsWith('.png'));
            if (files.length > 0) fgSrc = path.join(altPath, files[0]);
          }
        }
      }
    }
    
    // 2. Resolve background source
    let bgSrc = null;
    if (actKey === 'walk' && w.walkBg) {
      bgSrc = path.join(SRC, w.walkBg);
    } else {
      const dirPath = path.join(SRC, w.bg, subDir);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath).filter(f => f.endsWith('.png'));
        if (files.length > 0) bgSrc = path.join(dirPath, files[0]);
      } else {
        const altDir = actKey === 'slash' ? 'slash' : (actKey === 'thrust' ? 'thrust' : '');
        if (altDir) {
          const altPath = path.join(SRC, w.bg, altDir);
          if (fs.existsSync(altPath)) {
            const files = fs.readdirSync(altPath).filter(f => f.endsWith('.png'));
            if (files.length > 0) bgSrc = path.join(altPath, files[0]);
          }
        }
      }
    }
    
    // 3. Copy files (with foreground fallback)
    const fgDest = path.join(fgDestDir, `${actKey}.png`);
    const bgDest = path.join(bgDestDir, `${actKey}.png`);
    
    if (fgSrc && fs.existsSync(fgSrc)) {
      fs.copyFileSync(fgSrc, fgDest);
    }
    
    if (bgSrc && fs.existsSync(bgSrc)) {
      fs.copyFileSync(bgSrc, bgDest);
    } else if (fgSrc && fs.existsSync(fgSrc)) {
      // Fallback: copy foreground sheet to background if background is missing!
      fs.copyFileSync(fgSrc, bgDest);
    }
  }
}

// 8. Crusader Shield BG (Behind)
const shieldBgActions = ['walk', 'slash', 'thrust', 'spellcast', 'shoot', 'hurt'];
const shieldBgSrcDir = path.join(SRC, 'shield/crusader/bg');
if (fs.existsSync(shieldBgSrcDir)) {
  for (const act of shieldBgActions) {
    const srcFile = path.join(shieldBgSrcDir, `${act}.png`);
    if (fs.existsSync(srcFile)) {
      for (const g of ['male', 'female']) {
        const destDir = path.join(DEST, `shield_behind/crusader/fg/${g}`);
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(srcFile, path.join(destDir, `${act}.png`));
      }
    }
  }
}

console.log('Finished copying assets');
