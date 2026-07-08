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
  
  'eyes/human/adult',
  'head/ears/elven/adult',
  
  // Hairstyles
  'hair/bangs/adult', 'hair/braid/adult', 'hair/long/adult', 'hair/page/adult', 'hair/messy1/adult', 'hair/pixie/adult',
  'hair/bob/adult', 'hair/curly_long/adult', 'hair/dreadlocks_long/adult', 'hair/ponytail/adult', 'hair/spiked/adult',
  'hair/loose/adult', 'hair/swoop/adult', 'hair/parted/adult', 'hair/mop/adult',
  
  // Beards
  'beards/beard/basic', 'beards/beard/medium', 'beards/beard/5oclock_shadow', 'beards/mustache/basic',
  
  // Hats/Helmets
  'hat/helmet/greathelm/male', 'hat/helmet/greathelm/female',
  'hat/cloth/leather_cap', 'hat/headband/thick',
  
  // clothes
  'torso/clothes/longsleeve/longsleeve/male', 'torso/clothes/longsleeve/longsleeve/female',
  'torso/clothes/shortsleeve/shortsleeve/male', 'torso/clothes/shortsleeve/shortsleeve/female',
  'torso/clothes/robe/male', 'torso/clothes/robe/female',
  'torso/clothes/shirt/male', 'torso/clothes/shirt/female',
  
  // armour
  'torso/armour/leather/male', 'torso/armour/leather/female',
  'torso/armour/plate/male', 'torso/armour/plate/female',
  'torso/chainmail/male', 'torso/chainmail/female',
  
  // legs and feet
  'legs/pants/male', 'legs/pants/female',
  'legs/armour/plate/male', 'legs/armour/plate/female',
  'feet/shoes/basic/male', 
  'feet/shoes/basic/thin', 
  'feet/armour/plate/male', 'feet/armour/plate/female',
  
  // weapons
  'weapon/sword/longsword', 'weapon/sword/dagger', 'weapon/sword/rapier',
  'weapon/blunt/club', 'weapon/blunt/mace',
  'weapon/polearm/spear',
  'weapon/ranged/bow',
  'weapon/magic/wand'
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
console.log('Finished copying assets');
