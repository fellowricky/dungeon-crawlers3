/**
 * Story mode — hand-curated missions, one per chapter.
 *
 * A story mission is just a quest object (same contract startQuest /
 * _loadFloor / completeQuest already consume) with two extra markers:
 *   story: true      — completion is recorded in game.storyProgress
 *   mapKind:'overland' — _loadFloor routes the forge to engine.reforgeOverland
 * The fixed seed makes the map identical on every attempt, which is what
 * gives a "curated" feel while the layout still comes from the generator.
 */

import STORY_ENCOUNTER_OVERRIDES from './story_encounters.json' with { type: 'json' };

/* Opening crawl — shown once, right after a new party is created, before the
   world map reveals. Each paragraph is narrated (ids intro_crawl_p0..pN,
   synthesized by scripts/narration/extract_story.mjs + narrate_batch.py). */
export const INTRO_CRAWL = {
  title: 'DUNGEON CRAWLERS',
  subtitle: 'Chapter I — A New Company',
  paragraphs: [
    'A long age of peace is ending. In the borderlands beyond the old kingdoms, the roads grow dangerous, the watchtowers stand empty, and the deep places of the world are stirring once more.',
    'Monsters out of grandmother-tales now carry off herds and burn farmsteads. The crowns and their armies look inward, squabbling over old borders while the frontier cries for help that never comes.',
    'Into that silence step the free companies — sellswords, spell-slingers, and fortune-seekers who go where soldiers will not: for coin, for glory, or for reasons all their own.',
    'Tonight, in a roadside tavern at the edge of the wild, four such souls sign their names to a single charter. The pay is uneven. The work is ugly. And the world, though it would never admit it, is quietly desperate for heroes.'
  ]
};

export const STORY_MISSIONS = [
  {
    id: 'story_ch1',
    story: true,
    chapter: 1,
    name: 'Embers over Greenrise',
    siteName: 'Greenrise Vale — Goblin Warcamp',
    mapKind: 'overland',
    theme: 'forest',
    level: 1,
    floors: 5,
    seed: 771204,
    mapW: 84,
    mapH: 84,
    place: 'Greenrise Vale',
    locType: 'Warcamp',
    finalBossId: 'goblin-king',
    finalBossName: 'the Goblin King',
    bossArt: './art/ch1_goblinking.webp',
    bossArtLabel: 'Wearing plate that no goblin ever forged.',
    rewardGold: 200,
    rewardXp: 150,
    rewardItem: null,
    itemLevel: 1,

    /* Five-floor expedition: the trail in, deepening, then the camp itself.
       Only floor 5 has a boss — floors 1–4 end at the swept-floor exit tile. */
    floorPlan: [
      { mapKind: 'overland', theme: 'forest', name: 'Greenrise Vale — The Forest Trail',
        mapW: 72, mapH: 72,
        monsters: { 1: ['goblin', 'giant-rat', 'stirge'], 2: ['hobgoblin'] } },
      { mapKind: 'overland', theme: 'forest', name: 'Greenrise Vale — The Deep Thicket',
        mapW: 80, mapH: 80,
        monsters: { 1: ['goblin', 'wolf', 'giant-wolf-spider', 'swarm-of-rats'], 2: ['hobgoblin', 'giant-spider'] } },
      { mapKind: 'overland', theme: 'forest', name: 'Greenrise Vale — The Waystone Clearing',
        mapW: 76, mapH: 76,
        monsters: { 1: ['goblin', 'kobold', 'wolf', 'giant-badger'], 2: ['hobgoblin', 'thug'] } },
      { mapKind: 'overland', theme: 'forest', name: 'Greenrise Vale — The Camp Outskirts',
        mapW: 84, mapH: 84,
        monsters: { 1: ['goblin', 'kobold', 'wolf'], 2: ['hobgoblin', 'orc', 'thug'], 3: ['bugbear'] } },
      { mapKind: 'overland', theme: 'forest', name: 'Greenrise Vale — The Warcamp',
        mapW: 88, mapH: 88,
        monsters: { 1: ['goblin', 'kobold'], 2: ['hobgoblin', 'orc'], 3: ['bugbear', 'hobgoblin-captain'],
                    boss: ['goblin-king'] } }
    ],
    description:
      'Smoke rises over Greenrise Vale. A goblin warband has raised a palisaded camp ' +
      'in the deep of the forest, and the farms along the treeline are emptying one by ' +
      'one. Follow the forest trails, clear the outlying thickets, and put out the ' +
      'fire at its source: the self-styled Goblin King holding court behind the stakes.',
    embarkText:
      'The trail out of the village turns to packed dirt, then to wild grass. Between ' +
      'the trees, far off, a thin column of smoke marks the warcamp. The party walks in.',
    victoryText:
      'The palisade gate hangs open and the camp burns behind the party. Greenrise ' +
      'Vale will sleep quietly tonight.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: false,

    /* Curated skill challenges — fired once when the bound zone is searched
       (see checkRoomEntryChallenge in skills.js). Same card DSL as
       the random CHALLENGES pool; `visuals` overrides the name-keyed table. */
    storyChallenges: [
      {
        floor: 2,
        zone: 'treasure',
        challenge: {
          name: 'The Burned Farmstead', type: 'room', reward: { kind: 'potion' },
          desc: 'A farmhouse stands roofless in the thicket, burned weeks ago. The goblins took the tools and left the pantry — they were provisioning for work, not hunger.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk', backdrop: './art/ch1_farmstead.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Sweep the ruin',
              win: 'Under a fallen beam, the family’s medicine chest — scorched, intact, and welcome.',
              lose: 'Ash and nails. Whatever was worth taking went north with the raiders.' },
            { tier: 'standard', skill: 'investigation', label: 'Work out what they took',
              win: 'Saws, rope, hinges, a whetstone — and every drop of lamp oil. Someone up there is building by torchlight, in a hurry.',
              lose: 'The fire ate the evidence along with the roof.' },
            { tier: 'risky', skill: 'athletics', label: 'Shift the fallen beams', failEffect: 'damage',
              win: 'The cellar hatch comes clear — preserves, cordial, and the strongbox the goblins never found.',
              lose: 'The chimney stack picks its moment to come down.' }
          ]
        }
      },
      {
        floor: 5,
        zone: 'combat',
        challenge: {
          name: 'War-Drums', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'Inside the stakes, the drums start — deep, ragged, meant to rattle militia. The camp is telling the party what it thinks of visitors.',
          visuals: { props: ['./dcss/monster/goblin.png'], heroAnim: 'slash', backdrop: './art/ch1_wardrums.webp' },
          approaches: [
            { tier: 'safe', skill: 'performance', label: 'Sing over the drums',
              win: 'A marching song, loud and off-key and unbothered. The drummers lose the beat first, then their nerve.',
              lose: 'The drums are louder. The drums were always going to be louder.' },
            { tier: 'standard', skill: 'intimidation', label: 'Answer with steel on shields',
              win: 'Four blades on four shields, once, together. The drums stop. The silence that follows belongs to the party.',
              lose: 'The clatter reads as fear. The drumming doubles.' },
            { tier: 'risky', skill: 'stealth', label: 'Find and silence the drummers', failEffect: 'alert',
              win: 'Three drummers, three quiet endings. The camp’s heartbeat cuts out mid-measure, and the party walks in on the confusion.',
              lose: 'The fourth drummer sees everything — and beats a very different rhythm.' }
          ]
        }
      },
      {
        floor: 1,
        zone: 'combat',   // first wilderness clearing on the way in
        challenge: {
          name: 'Snare Line', type: 'room', reward: { kind: 'gold' },
          desc: 'Tripwires and leg-snares web the undergrowth across the trail — goblin work, and fresh. Somewhere past them, a bag of "toll" takings hangs from a branch.',
          visuals: { props: ['./dcss/effect/net_trap.png'], heroAnim: 'walk', backdrop: './art/ch1_snareline.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Pick a path around',
              win: 'You spot every wire and thread the party through — and cut down the goblins’ toll bag on the way.',
              lose: 'Too many wires to trust. The party backtracks and loses the light.' },
            { tier: 'standard', skill: 'survival', label: 'Read the trapper’s pattern',
              win: 'Goblin snares repeat like a bad song. You spring them all with a long stick and pocket the takings.',
              lose: 'The pattern breaks halfway through. A snare snaps shut on empty air — and the party’s nerves.' },
            { tier: 'risky', skill: 'sleightOfHand', label: 'Harvest the snares for parts', failEffect: 'damage',
              win: 'Wire, springs, AND the toll bag — the goblins just restocked your coin purse.',
              lose: 'A hidden counter-snare whips through the grass and bites deep.' }
          ]
        }
      },
      {
        floor: 3,
        zone: 'shrine',
        challenge: {
          name: 'The Defaced Waystone', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'An old waystone stands in the clearing, smeared with goblin war-paint. Beneath the filth, its blessing still hums.',
          visuals: { props: ['./dcss/item/misc/misc_crystal.png'], heroAnim: 'spellcast',
                     backdrop: './art/ch1_waystone.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Speak the old rites',
              win: 'The words come slowly, then all at once. The paint flakes away and warmth settles over the party.',
              lose: 'Whatever tongue the stone answers to, it isn’t this one.' },
            { tier: 'standard', skill: 'nature', label: 'Scrub it clean with forest herbs',
              win: 'Crushed silverleaf cuts the war-paint like lye. The stone brightens — and so does the party.',
              lose: 'The paint is mixed with something foul that won’t lift. The stone stays dark.' },
            { tier: 'risky', skill: 'arcana', label: 'Force the wards awake', failEffect: 'damage',
              win: 'Power arcs from the stone in a ring. Every blade in the party hums with borrowed light.',
              lose: 'The stone rejects the intrusion with a crack of raw force.' }
          ]
        }
      },
      {
        floor: 4,        // fires at the exit tile — the gate is the way in
        zone: 'boss',
        challenge: {
          name: 'The Palisade Gate', type: 'room', reward: { kind: 'tempHp' },
          desc: 'The warcamp’s stake-wall looms ahead, torchlit and crawling with sentries. One good move decides how this assault begins.',
          visuals: { props: ['./dcss/monster/goblin.png', './dcss/monster/hobgoblin.png'], heroAnim: 'slash', backdrop: './art/ch1_palisade.webp' },
          approaches: [
            { tier: 'safe', skill: 'stealth', label: 'Slip along the stakes', party: true,
              win: 'The party ghosts along the palisade’s shadow and is inside before the first horn blows. Hearts steady, guards up.',
              lose: 'A snapped twig, a barked alarm — so much for the quiet way.' },
            { tier: 'standard', skill: 'intimidation', label: 'Bellow a challenge at the gate',
              win: 'Half the sentries flinch off the wall at the sound alone. The party walks in over their nerve.',
              lose: 'The goblins jeer back in a hundred voices. It was worth a try.' },
            { tier: 'risky', skill: 'athletics', label: 'Rush the gate before they rally', failEffect: 'alert',
              win: 'Shoulders down, the party hits the gate like a battering ram and is through before the camp can breathe.',
              lose: 'The gate holds a heartbeat too long — and every horn in the camp starts screaming.' }
          ]
        }
      }
    ],

    /* End-of-floor story beats — fire when a non-boss floor is swept (see
       maybeFireFloorBeat in game.js). A short voiced branching scene keyed by
       floor number, ending in a skill challenge. Each Ch1 beat plants one more
       sign that whatever the goblins are raiding for comes from far deeper
       stone than any goblin should reach — paying off at the King's armor. */
    floorBeats: {
      1: {
        place: 'The Forest Trail — swept',
        speaker: 'On the way out',
        art: './art/ch1_fb1.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The trail is clear behind you. But a goblin lies dead in the ferns where no blade put it — sprawled facing the village, away from its own camp. It died running the wrong way.',
            choices: [
              { label: 'Kneel by the body', next: 'body' },
              { label: 'Read the churned ground', next: 'ground' }
            ]
          },
          body: {
            text: 'No wound. No blood. Its hands are torn from clawing through bramble in the dark, and its face is fixed in something that isn’t a warrior’s death. It ran until its heart stopped.',
            go: 'So what was it running from?'
          },
          ground: {
            text: 'Only its own tracks, and they come from deeper in — from the camp, from the smoke. It didn’t flee the village. It fled toward it, hard enough to kill itself on the run.',
            go: 'So what was it running from?'
          }
        },
        challenge: {
          name: 'What the Goblin Fled', nid: 'ch1_fb1', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A goblin dead of pure terror, pointed the wrong way. Read what it knew that its own war-king does not.',
          visuals: { props: ['./dcss/monster/goblin.png'], heroAnim: 'walk', backdrop: './art/ch1_fb1_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'survival', label: 'Backtrack its final run',
              win: 'Its trail starts deep — past the camp, past where goblins should den. Something down there emptied even the raiders out.',
              lose: 'The trail folds into a hundred others. Whatever it saw, it kept to itself.' },
            { tier: 'standard', skill: 'medicine', label: 'Read how it died',
              win: 'Nothing killed it but its own body, spent. To run like that, in the dark, a goblin has to be more afraid of what’s behind than what’s ahead.',
              lose: 'Cold and stiff and telling you nothing you can trust.' },
            { tier: 'risky', skill: 'investigation', label: 'Work out what it carried', failEffect: 'debuff',
              win: 'Deep-stone grit under its nails, the same grey dust that has no business this high. It touched something far below and bolted.',
              lose: 'You linger too long over a dead thing, and the woods drink your nerve.' }
          ]
        }
      },
      2: {
        place: 'The Deep Thicket — swept',
        speaker: 'Among the trees',
        art: './art/ch1_fb2.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The thicket is dead quiet — not the quiet of a cleared floor, the quiet of a place the animals left in a hurry. Nests abandoned mid-clutch. A badger sett dug open from the inside.',
            choices: [
              { label: 'Study the sett', next: 'sett' },
              { label: 'Look up the trunks', next: 'trunks' }
            ]
          },
          sett: {
            text: 'The badger didn’t flee a predator at the mouth — it clawed straight up and out through the roof of its own burrow, as if the danger came from below, through the earth.',
            go: 'Everything here fled upward.'
          },
          trunks: {
            text: 'Claw-marks rake the bark high overhead — squirrels, martens, birds, everything that could climb, gone as high as it could go. Nothing that lives in the ground stayed in the ground.',
            go: 'Everything here fled upward.'
          }
        },
        challenge: {
          name: 'The Wrong Marks', nid: 'ch1_fb2', type: 'room', reward: { kind: 'tempHp' },
          desc: 'A whole thicket of animals that all fled the same way — up, and out, and away from the ground. Learn what they knew before you have to.',
          visuals: { props: ['./dcss/monster/animals/grey_rat.png'], heroAnim: 'walk', backdrop: './art/ch1_fb2_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'nature', label: 'Read the animals’ panic',
              win: 'They didn’t scatter from a wolf. They evacuated — all at once, all upward, the way beasts run from a flood or a quake. From something underneath.',
              lose: 'Animals spook at everything. You can’t read a story into every empty nest.' },
            { tier: 'standard', skill: 'perception', label: 'Feel the ground underfoot',
              win: 'A faint tremor, so low it’s more felt than heard, comes up through your boots at long intervals. The forest has been feeling it for weeks.',
              lose: 'Just the wind and your own pulse. If the ground is speaking, it isn’t to you.' },
            { tier: 'risky', skill: 'athletics', label: 'Climb to where they climbed', failEffect: 'damage',
              win: 'From the high branches you can see it: a long seam of collapsed ground threading toward the camp, as if something ran a furrow under the whole vale.',
              lose: 'The bough that held a marten’s weight does not hold yours.' }
          ]
        }
      },
      3: {
        place: 'The Waystone Clearing — swept',
        speaker: 'At the old stone',
        art: './art/ch1_fb3.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The goblins painted their filth over the old waystone — you saw that on the way in. But now, with the clearing quiet, you can see the war-paint isn’t random daubing. It’s copying something.',
            choices: [
              { label: 'Scrape at the paint', next: 'scrape' },
              { label: 'Compare the marks', next: 'compare' }
            ]
          },
          scrape: {
            text: 'Under the flaking ochre, cut deep into the granite, is a symbol far older than any goblin scrawl — precise, angular, worn smooth by centuries. The goblins painted over it because they’re afraid to touch it.',
            go: 'Where did they even see it?'
          },
          compare: {
            text: 'The same angular mark repeats on their crude fetishes, clumsily, again and again. They didn’t invent it. They copied it — from somewhere they’ve been, and won’t go back to.',
            go: 'Where did they even see it?'
          }
        },
        challenge: {
          name: 'Under the Paint', nid: 'ch1_fb3', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A deep-cut sigil under the goblins’ war-paint, older than the kingdom and copied by frightened hands. Name it if you can.',
          visuals: { props: ['./dcss/item/misc/misc_rune.png'], heroAnim: 'spellcast', backdrop: './art/ch1_fb3_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'history', label: 'Place the stonework',
              win: 'This is deep-realm masonry — the old binding-craft of the folk who cut the roots of mountains, long before any crown drew a border here.',
              lose: 'It matches nothing in any chronicle you were ever taught. Which is its own kind of answer.' },
            { tier: 'standard', skill: 'religion', label: 'Read it as a ward',
              win: 'It isn’t a blessing. It’s a seal — a warding-mark meant to keep something shut. And it’s worn from the inside, as if something leaned on it for a very long time.',
              lose: 'The shape squirms away from meaning. Some marks don’t want to be read.' },
            { tier: 'risky', skill: 'arcana', label: 'Wake the mark’s memory', failEffect: 'curse',
              win: 'You touch the groove and feel the shape of it — a door-mark, deep and downward, and the goblins are squatting on the porch of something enormous.',
              lose: 'The sigil answers your prod with a cold that climbs your arm and settles behind your eyes.' }
          ]
        }
      },
      4: {
        place: 'The Camp Outskirts — swept',
        speaker: 'Below the stakes',
        art: './art/ch1_fb4.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The palisade looms just ahead now, torchlit. But here at the outskirts, a fallen section lets you see how it’s built — and the goblins didn’t lash these timbers with rope.',
            choices: [
              { label: 'Handle the fastening', next: 'fasten' },
              { label: 'Follow the chain’s run', next: 'run' }
            ]
          },
          fasten: {
            text: 'Iron chain. Fine, close-forged links, dark and old and precise — smith-work no goblin ever managed. It’s scavenged, hauled up from somewhere, and there is a great deal of it.',
            go: 'The same place the King got his armour.'
          },
          run: {
            text: 'The chain runs everywhere — binding stakes, dragging sledges, hung with skulls. They found a hoard of the stuff and use it like rope, without the first idea what they’re handling.',
            go: 'The same place the King got his armour.'
          }
        },
        challenge: {
          name: 'Iron Where There Should Be Rope', nid: 'ch1_fb4', type: 'room', reward: { kind: 'shortcut' },
          desc: 'Deep-forged iron chain, far too fine for goblin hands, lashing a goblin wall together. Trace where a warband found so much of it.',
          visuals: { props: ['./dcss/item/armor/torso/chain_mail_1.png'], heroAnim: 'slash', backdrop: './art/ch1_fb4_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Trace the chain to its source',
              win: 'Drag-marks haul the chain up out of a raw sinkhole behind the camp — a shaft into dressed stone the goblins broke into, not built.',
              lose: 'The trail of it vanishes into the camp’s churn. You’ll have to ask the King where he shops.' },
            { tier: 'standard', skill: 'insight', label: 'Read how they treat it',
              win: 'They handle the chain like loot and the King wears the plate like a crown — trophies, not tools. None of them grasp they’ve robbed a tomb that was holding something down.',
              lose: 'Goblins hoard shiny things. Reading further into it is your own nerves talking.' },
            { tier: 'risky', skill: 'athletics', label: 'Wrench a length free for the assault', failEffect: 'alert',
              win: 'You lever a whole run of chain loose — and the collapse it opens gives you a clean, quiet way in past the gate.',
              lose: 'The chain is anchored deeper than you thought. It rings like a bell, and the wall answers.' }
          ]
        }
      }
    },

    /* Pre-mission briefing: branching dialogue shown between selecting the
       mission and forging the map. Node effects apply the moment the node is
       entered (once per briefing): gold / potion:{kind} / flag:'name'.
       Flags land on quest.storyFlags for map/challenge logic to read. */
    briefing: {
      speaker: 'Elder Rowena of Greenrise',
      portrait: null,
      art: './art/ch1_briefing.webp',
      start: 'root',
      nodes: {
        root: {
          text: 'So you’re the blades our coin bought. Three farms burned in a fortnight, our herds driven into the deepwood, and now the vermin have a king — or something that calls itself one. Ask what you need to ask. Then go earn your gold.',
          choices: [
            { label: '“Tell us about the raids.”', next: 'raids' },
            { label: '“What did your scouts learn before they stopped coming back?”', next: 'scouts' },
            { label: '“We could use supplies for the road.”', next: 'supplies' },
            { label: '“Enough talk. We march.”', setOut: true }
          ]
        },
        raids: {
          text: 'They come at dusk, always from the north trail, always gone before the militia musters. They aren’t starving raiders — they take tools, rope, whetstones. Someone up there is BUILDING something. That worries me more than the burning.',
          choices: [
            { label: '“What else?”', next: 'root' },
            { label: '“Then we’ll go see what he’s building. We march.”', setOut: true }
          ]
        },
        scouts: {
          text: 'Old Fenwick got closest. Before the fever took his tongue he drew this — snare lines across the east clearing, thick as a spider’s web, and a stake-wall ringing their camp with two gates. Take his map. Mind the wires.',
          effect: { flag: 'scouted' },
          choices: [
            { label: '“This will help. What else?”', next: 'root' },
            { label: '“With this map we won’t need luck. We march.”', setOut: true }
          ]
        },
        supplies: {
          text: 'We’re not rich — the goblins saw to that — but the herbalist owes me a favor. Here: a healing draught, brewed strong. Bring my people back some peace and we’ll call it a fair trade.',
          effect: { potion: 'heal' },
          choices: [
            { label: '“Our thanks. A few more questions.”', next: 'root' },
            { label: '“This will do. We march.”', setOut: true }
          ]
        }
      }
    }
  },

  /* ================= CHAPTER II ================================
     The first wrong detail. Ch1's goblins were fleeing something; here the
     party follows the livestock they drove and finds the goblins ran PAST
     good territory to get away. Boss is a grick — a deep-dweller with no
     business under open sky. Nobody says the word "seal" for another three
     chapters, but this is where the arc actually starts. */
  {
    id: 'story_ch2',
    story: true,
    chapter: 2,
    name: 'What the Herds Fled',
    siteName: 'The Longbarrow Drove-road',
    mapKind: 'overland',
    theme: 'moor',
    level: 2,
    floors: 5,
    seed: 448317,
    mapW: 92,
    mapH: 88,
    place: 'Longbarrow Moor',
    locType: 'Drove-road',
    finalBossId: 'grick',
    finalBossName: 'the thing in the sinkhole',
    bossArt: './art/ch2_grick.webp',
    bossArtLabel: 'Nothing on the surface has a name for it.',
    /* A grick is a CR-2 block — right for the story, far too light for a
       chapter boss (23 HP raw). Scaled to roughly goblin-king weight. */
    bossHpMult: 4.5,
    rewardGold: 320,
    rewardXp: 280,
    rewardItem: null,
    itemLevel: 2,

    /* Beasts and vermin only — and pointedly NO goblins. The absence is the
       story beat: the party is walking through country the goblins refused.
       Fallback for any floor the plan below doesn't pin. */
    monsterRoster: {
      1: ['wolf', 'giant-weasel', 'giant-badger', 'stirge', 'swarm-of-rats', 'giant-wolf-spider'],
      2: ['dire-wolf', 'giant-spider', 'wolf-spider', 'harpy'],
      3: ['grick', 'owlbear'],
      boss: ['grick']
    },

    /* Three floors of open moor, then down through the dressed stone the
       sinkhole opened. The theme change at floor 4 IS the reveal. */
    floorPlan: [
      { mapKind: 'overland', theme: 'moor', name: 'Longbarrow Moor — The Drove-road',
        mapW: 92, mapH: 88,
        monsters: { 1: ['wolf', 'giant-weasel', 'stirge', 'swarm-of-rats'], 2: ['dire-wolf'] } },
      { mapKind: 'overland', theme: 'moor', name: 'Longbarrow Moor — The High Pasture',
        mapW: 80, mapH: 80,
        monsters: { 1: ['wolf', 'giant-badger', 'giant-wolf-spider', 'giant-owl'], 2: ['dire-wolf', 'harpy'] } },
      { mapKind: 'overland', theme: 'moor', name: 'Longbarrow Moor — The Walled Fold',
        mapW: 84, mapH: 84,
        monsters: { 1: ['wolf', 'giant-weasel', 'giant-badger'], 2: ['dire-wolf', 'giant-spider', 'harpy'], 3: ['owlbear'] } },
      { mapKind: 'dungeon', theme: 'ancient', name: 'Under the Drove-road — Dressed Stone',
        monsters: { 1: ['giant-rat', 'swarm-of-bats', 'giant-centipede'], 2: ['giant-spider', 'grick'], 3: ['grick'] } },
      { mapKind: 'dungeon', theme: 'ancient', name: 'Under the Drove-road — The Pit',
        monsters: { 1: ['giant-rat', 'swarm-of-bats'], 2: ['giant-spider', 'grick'], 3: ['grick', 'ogre'],
                    boss: ['grick'] } }
    ],

    description:
      'Greenrise is safe, but its herds never came home. The drove-road climbs out of ' +
      'the treeline onto Longbarrow Moor — open country, good grazing, no cover for a ' +
      'goblin raiding party. Follow the tracks. Find out where four hundred head of ' +
      'cattle were driven, and why the goblins who drove them kept running afterward.',
    embarkText:
      'The trees thin, then stop. Grey grass runs to the horizon under a low ceiling of ' +
      'cloud, and the drove-road cuts through it like a scar. Somewhere ahead, carrion ' +
      'birds are circling something that is not moving.',
    victoryText:
      'The thing from the sinkhole lies still, and it is nothing anyone on the surface ' +
      'has a name for. The cattle are past saving. The party stands at the lip of the ' +
      'hole a while, looking down, and nobody suggests going deeper.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: false,

    storyChallenges: [
      {
        floor: 2,
        zone: 'shrine',
        challenge: {
          name: 'The Shepherd’s Bothy', type: 'room', reward: { kind: 'potion' },
          desc: 'A drystone hut on the high pasture, door swinging. The shepherd’s gear is all here. The shepherd is not, and the dog would not have left him.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'walk', backdrop: './art/ch2_bothy.webp' },
          approaches: [
            { tier: 'safe', skill: 'survival', label: 'Read the ground outside',
              win: 'Man and dog left together, at a run, southbound — alive, then. His stores are honestly abandoned, and honestly useful.',
              lose: 'Sheep-tracks over everything. The moor keeps its secrets.' },
            { tier: 'standard', skill: 'medicine', label: 'Check the medicine shelf',
              win: 'Liniment, feverbark, a sealed draught — shepherds doctor their flocks and themselves. It keeps.',
              lose: 'Damp got the shelf. Everything’s turned.' },
            { tier: 'risky', skill: 'history', label: 'Read his tally-book by the cold hearth', failEffect: 'frighten',
              win: 'Neat counts for thirty years, then the last page: “ground opened by the fold. It sounds like breathing.” Dated nine days ago — forewarned is forearmed.',
              lose: 'The last entry is only a drawing — and you wish he hadn’t been any good at drawing.' }
          ]
        }
      },
      {
        floor: 5,
        zone: 'combat',
        challenge: {
          name: 'What the Cattle Saw', type: 'room', reward: { kind: 'tempHp' },
          desc: 'The bone pit narrows here. Four hundred head came down this passage at a gallop, in the dark, and the walls remember it — horn-scores chest-high in the dressed stone.',
          visuals: { props: ['./dcss/effect/cloud_calc_dust_0.png'], heroAnim: 'walk', backdrop: './art/ch2_bonepit.webp' },
          approaches: [
            { tier: 'safe', skill: 'nature', label: 'Read the stampede',
              win: 'They weren’t driven down — they were TURNED, twice, by something herding them deeper. Knowing how it moves is half an armour.',
              lose: 'Panic writes badly. The scores tell you nothing but panic.' },
            { tier: 'standard', skill: 'insight', label: 'Think like the thing below',
              win: 'It didn’t eat them all. It stored them. Things that store food defend larders, and larders have blind sides.',
              lose: 'You cannot make yourself think like it. Perhaps be glad.' },
            { tier: 'risky', skill: 'religion', label: 'Say words over the herd', failEffect: 'frighten',
              win: 'It is only cattle, and you say the words anyway, and the passage feels wider for it. Steadier hearts going in.',
              lose: 'Something below answers the rite — in kind, and wrong.' }
          ]
        }
      },
      {
        floor: 1,
        zone: 'combat',
        challenge: {
          name: 'Drag Marks', type: 'room', reward: { kind: 'shortcut' },
          desc: 'The drove-road is churned to mud for a hundred paces. Hooves, and among them narrower prints, running in the same direction — not behind the herd, but level with it.',
          visuals: { props: ['./dcss/effect/cloud_calc_dust_0.png'], heroAnim: 'walk', backdrop: './art/ch2_dragmarks.webp' },
          approaches: [
            { tier: 'safe', skill: 'survival', label: 'Read the trail',
              win: 'The herd wasn’t driven — it bolted. And the goblin prints beside it are running flat out, in the same direction, keeping pace out of terror rather than herding anything.',
              lose: 'Too much traffic, too much rain. The mud gives up nothing but mud.' },
            { tier: 'standard', skill: 'perception', label: 'Count the tracks',
              win: 'Two hundred goblin prints, and not one of them turns back. Whatever they were fleeing, they never once looked over their shoulder to check.',
              lose: 'The count comes apart halfway. Prints on prints on prints.' },
            { tier: 'risky', skill: 'investigation', label: 'Reconstruct the panic', failEffect: 'damage',
              win: 'You walk the whole churn backward and put the hour together: the herd and the raiders broke at the same instant, from the same thing, coming up from under the road.',
              lose: 'Absorbed in the ground, you miss the gorse-line — and something in it does not miss you.' }
          ]
        }
      },
      {
        floor: 3,
        zone: 'treasure',
        challenge: {
          name: 'The Abandoned Camp', type: 'room', reward: { kind: 'potion' },
          desc: 'A goblin camp, struck in a hurry and never returned to. Cook-fires still ringed with stones. Bedrolls left where they lay. Nobody loots their own camp this badly unless they left at a dead run.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk', backdrop: './art/ch2_abandonedcamp.webp' },
          approaches: [
            { tier: 'safe', skill: 'sleightOfHand', label: 'Pick it over quickly',
              win: 'Whetstones, salt, a stoppered flask of something medicinal. The goblins packed for a long stay and left inside a minute.',
              lose: 'Everything worth taking is spoiled, sodden, or worse.' },
            { tier: 'standard', skill: 'nature', label: 'Salvage what keeps',
              win: 'Dried meat, a bundle of usable herbs, and — oddly — three days of firewood stacked neat. They meant to be here a week.',
              lose: 'Damp has got into all of it. Not worth the weight.' },
            { tier: 'risky', skill: 'athletics', label: 'Haul the whole cache out', failEffect: 'damage',
              win: 'The party carries off the lot, flask and firewood and all. Someone will be glad of it tonight.',
              lose: 'A rotted tent-pole gives under the load and drops the whole stack on somebody’s foot.' }
          ]
        }
      },
      {
        floor: 4,
        zone: 'boss',
        challenge: {
          name: 'Down the Throat', type: 'room', reward: { kind: 'tempHp' },
          desc: 'The sinkhole is forty feet across and the cattle are all at the bottom of it, piled and broken. The walls are not earth. They are dressed stone, and the hole did not collapse inward — something came up.',
          visuals: { props: ['./dcss/item/misc/misc_rune.png'], heroAnim: 'walk',
                     backdrop: './art/ch2_sinkhole.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Find the safe ledge',
              win: 'A shelf of intact masonry rings the pit ten feet down. The party descends to it dry-footed and arrives braced.',
              lose: 'Every ledge you trust crumbles when weighted. The descent will have to be the hard way.' },
            { tier: 'standard', skill: 'athletics', label: 'Rope descent',
              win: 'Pitons into the dressed stone, rope through, down in good order — and everyone reaches the bottom with breath left to fight.',
              lose: 'The rope runs short and the last drop is longer than anybody wanted.' },
            { tier: 'risky', skill: 'acrobatics', label: 'Free-climb the fastest way down', failEffect: 'damage',
              win: 'Hand over hand down the old stonework, quick and quiet, and on the floor of the pit before the thing below registers company.',
              lose: 'A wet handhold, a short fall, and a hard landing among the bones of somebody’s cattle.' }
          ]
        }
      }
    ],

    /* End-of-floor beats: the goblins fled this country too, and the party
       reads the panic in reverse as it climbs down toward what caused it. */
    floorBeats: {
      1: {
        place: 'The Drove-road — swept',
        speaker: 'On the drove-road',
        art: './art/ch2_fb1.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'Four hundred head of cattle came up this road at a gallop — you can read that much in the churn. But strewn along the verge is something stranger: goblin war-gear, thrown down and abandoned in a running line.',
            choices: [
              { label: 'Gather the dropped gear', next: 'gear' },
              { label: 'Read the running line', next: 'line' }
            ]
          },
          gear: {
            text: 'Shields, spears, a cracked war-horn, a chief’s notched blade — good goblin arms by their standard, all flung aside. They stripped themselves to run lighter. Goblins do not drop their weapons. Not for anything.',
            go: 'What makes a warband do that?'
          },
          line: {
            text: 'The gear falls in a line that runs the same way the cattle ran — uphill, outward, away. The goblins weren’t driving this herd. They were running in it, shoulder to flank with the cows, and losing.',
            go: 'What makes a warband do that?'
          }
        },
        challenge: {
          name: 'The Dropped Spears', nid: 'ch2_fb1', type: 'room', reward: { kind: 'gold' },
          desc: 'A warband’s weapons thrown down in a running line beside the cattle-track. Read what put a whole raiding party to rout without a fight.',
          visuals: { props: ['./dcss/monster/goblin.png'], heroAnim: 'walk', backdrop: './art/ch2_fb1_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Sort the abandoned arms',
              win: 'Not a blade among them is blooded. There was no battle here — only flight. Whatever they fled, they never once turned to face it.',
              lose: 'Rust and mud and too many hands through it already. It keeps its secret.' },
            { tier: 'standard', skill: 'survival', label: 'Follow the line to its head',
              win: 'The dropped gear thins toward the deep end of the vale and stops at torn ground — they came up out of the earth already running, and never slowed.',
              lose: 'The trail scatters into the moor. You lose which way panic was pointing.' },
            { tier: 'risky', skill: 'insight', label: 'Stand where they broke', failEffect: 'frighten',
              win: 'You feel it in the shape of the rout: not an enemy they could fight, but a wrongness that unmade the will to. Even a goblin knew to simply run.',
              lose: 'You put yourself too well in their skins, and the dread they dropped here finds a new set of shoulders.' }
          ]
        }
      },
      2: {
        place: 'The High Pasture — swept',
        speaker: 'On the high ground',
        art: './art/ch2_fb2.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The high pasture is a killing-ground with no killer. A whole flock of sheep lies dead across the slope below a low bluff — dozens of them, piled where they fell, and not one has been eaten.',
            choices: [
              { label: 'Examine the fallen', next: 'fallen' },
              { label: 'Look to the bluff', next: 'bluff' }
            ]
          },
          fallen: {
            text: 'Broken necks and broken legs, every one. No bite, no claw, no blood drawn by anything but the fall. They weren’t hunted. They ran off the edge in the dark, in a mass, and kept coming until the pile was this high.',
            go: 'The same way the cattle will go.'
          },
          bluff: {
            text: 'The turf at the bluff’s lip is torn to mud by a thousand small hooves, all pointed off the edge. Sheep don’t run off a height. Not unless what’s behind them is worse than the drop.',
            go: 'The same way the cattle will go.'
          }
        },
        challenge: {
          name: 'The Uneaten Flock', nid: 'ch2_fb2', type: 'room', reward: { kind: 'tempHp' },
          desc: 'A whole flock run off a bluff in the dark and left to rot. Learn what herds animals to their deaths and never stops to feed.',
          visuals: { props: ['./dcss/monster/animals/grey_rat.png'], heroAnim: 'walk', backdrop: './art/ch2_fb2_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'medicine', label: 'Read the wounds',
              win: 'Every death is the fall itself — panic, not predation. Whatever moved them wanted them gone, not eaten. That is a colder thing than any wolf.',
              lose: 'Days dead and days rained on. The bodies have stopped answering questions.' },
            { tier: 'standard', skill: 'nature', label: 'Reconstruct the stampede',
              win: 'One source of terror, low and behind, sweeping the flock off the height in a single surge — exactly the shape of what took the cattle down the throat of the moor.',
              lose: 'A flock is chaos even when it’s calm. You can’t untangle this one.' },
            { tier: 'risky', skill: 'perception', label: 'Search the ground they fled', failEffect: 'poison',
              win: 'Between the bodies, a seam of collapsed earth breathes cold, foul air up from below. The pasture is a lid, and it is beginning to lift.',
              lose: 'You crouch too long over rot in the wind, and it gets into your chest.' }
          ]
        }
      },
      3: {
        place: 'The Walled Fold — swept',
        speaker: 'At the old fold',
        art: './art/ch2_fb3.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The old drystone sheep-fold should have kept a flock safe. Instead its wall is burst — not fallen inward, but blown outward, its stones flung yards across the grass, as though something inside pushed its way out.',
            choices: [
              { label: 'Study the burst wall', next: 'wall' },
              { label: 'Cross to the slumped ground', next: 'slump' }
            ]
          },
          wall: {
            text: 'The stones lie in a fan, outward, the way a dropped melon throws its rind. Nothing got in over this wall. Something came up under it and shouldered the whole fold aside on its way to the open air.',
            go: 'And it left a hole.'
          },
          slump: {
            text: 'The turf inside the fold has slumped into a shallow bowl, and through the mud at its centre shows a course of fitted grey stone — dressed, jointed, deliberate. A buried wall, or a shaft, and it is not far down.',
            go: 'And it’s opening.'
          }
        },
        challenge: {
          name: 'The Fold That Burst', nid: 'ch2_fb3', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A stone fold shoved apart from the inside, and dressed masonry surfacing through the mud beneath it. Measure how close the deep has come to the surface.',
          visuals: { props: ['./dcss/item/misc/misc_stone.png'], heroAnim: 'slash', backdrop: './art/ch2_fb3_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Trace the outward blast',
              win: 'Every stone points away from one spot at the fold’s heart. Whatever surfaced here chose this weak seam in the ground and simply walked up through it.',
              lose: 'Tumbled stone is tumbled stone. You can’t swear which way it fell.' },
            { tier: 'standard', skill: 'history', label: 'Name the buried stonework',
              win: 'The jointing is deep-realm work — the same hidden masonry the whole moor is built over. The shepherds walled their flocks on the roof of something old, and never knew.',
              lose: 'Old stone under a sheepfold. You can date it no closer than "before us."' },
            { tier: 'risky', skill: 'athletics', label: 'Clear the mud from the shaft', failEffect: 'damage',
              win: 'You haul the slumped turf back and expose a stair-head of dressed stone descending into dark — the way down, days ahead of where the drove-road will take you.',
              lose: 'The lip of the bowl gives way under you and drops you hard onto buried stone.' }
          ]
        }
      },
      4: {
        place: 'Under the Drove-road — swept',
        speaker: 'Below the moor',
        art: './art/ch2_fb4.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The moor is above you now. Down here the walls are flawless ancient masonry, and at the stairhead a great marker-stone is set into the wall — deep-carved, deliberate, and turned to face upward, toward the surface, toward anyone climbing down.',
            choices: [
              { label: 'Study the marker', next: 'marker' },
              { label: 'Read which way it faces', next: 'facing' }
            ]
          },
          marker: {
            text: 'No boast, no tomb-name, no welcome. The carving is stark and functional — the deep-realm sign for a threshold that must not be crossed, cut by folk who expected to be obeyed.',
            go: 'A warning, then.'
          },
          facing: {
            text: 'Every tomb faces its dead. This faces the stairs. It wasn’t set to keep robbers out — it was set to be read by anyone coming down from above, and to turn them back. It faces us.',
            go: 'A warning, and we’re walking past it.'
          }
        },
        challenge: {
          name: 'The Marker Facing Up', nid: 'ch2_fb4', type: 'room', reward: { kind: 'shortcut' },
          desc: 'A deep-carved warning set to face the surface, meant to turn back anyone descending. Read it before you decide to ignore it.',
          visuals: { props: ['./dcss/item/misc/misc_rune.png'], heroAnim: 'spellcast', backdrop: './art/ch2_fb4_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'history', label: 'Place the marker’s makers',
              win: 'The same hands that cut the sigil on Greenrise’s waystone cut this — an order that walled the deep places shut and posted signs for a world that has forgotten how to read them.',
              lose: 'Ancient, authoritative, and utterly beyond your histories.' },
            { tier: 'standard', skill: 'religion', label: 'Read the threshold rite',
              win: 'It is a consecrated boundary — a line drawn between the living country above and something the makers judged must never come up. The consecration is old, and it is failing.',
              lose: 'The rite is real but its meaning has rotted with its keepers.' },
            { tier: 'risky', skill: 'arcana', label: 'Sound the marker’s ward', failEffect: 'curse',
              win: 'The stone still hums with a binding-charge, thin as a held breath. Whatever it seals has been leaning on it from below for a very long time — and the herds felt the seam give.',
              lose: 'You press the ward for an answer and it presses back, cold and patient, into your marrow.' }
          ]
        }
      }
    },

    briefing: {
      speaker: 'Hallam the Drover',
      portrait: null,
      art: './art/ch2_briefing.webp',
      start: 'root',
      nodes: {
        root: {
          text: 'You’re the ones burned out the camp at Greenrise. Good. Then you’ll believe me when I say this isn’t goblin work. I’ve driven cattle over that moor for thirty years. Four hundred head don’t vanish. And goblins don’t run past good grazing without stopping to eat it.',
          choices: [
            { label: '“What do you mean, they ran past it?”', next: 'ranpast' },
            { label: '“Has anyone been up to look?”', next: 'looked' },
            { label: '“What’s the road like?”', next: 'road' },
            { label: '“We’ll bring back what we find. We march.”', setOut: true }
          ]
        },
        ranpast: {
          text: 'I mean the tracks go one way and don’t stop. Past the water. Past the good pasture. Past a walled fold where they could’ve penned the whole herd and taken their time. They went by all of it at a dead run and kept going. That’s not raiding, that’s fleeing.',
          choices: [
            { label: '“Fleeing what?”', next: 'looked' },
            { label: '“Then we’ll find what’s behind them. We march.”', setOut: true }
          ]
        },
        looked: {
          text: 'My nephew went. Came back the same night, which is how I know how far he got. Said there’s a hole in the drove-road wide as a barn, and the sides of it are cut stone. Cut, mind. Nobody built anything on that moor. Here — he drew the pitch of it before his hands went bad.',
          effect: { flag: 'scouted' },
          choices: [
            { label: '“We’ll take the sketch. Anything else?”', next: 'root' },
            { label: '“Cut stone on open moor. We march.”', setOut: true }
          ]
        },
        road: {
          text: 'Open the whole way — no cover, but nothing to ambush you from either. Wind’ll cut you in half up top, so take the oilskins, and take this. Brewed for men who’ve been out in it too long. It’ll put your feet back under you.',
          effect: { potion: 'heal' },
          choices: [
            { label: '“Obliged. A few more questions.”', next: 'root' },
            { label: '“That’ll do. We march.”', setOut: true }
          ]
        }
      }
    }
  },

  /* ================= CHAPTER III ===============================
     First descent, and the first hard proof. Floor 1 is the moor approach to
     an empty watchtower; floor 2 is the stair beneath it that has no business
     existing. The garrison went down willingly — that's the detail that
     should bother the player, because it prefigures Ch12. */
  {
    id: 'story_ch3',
    story: true,
    chapter: 3,
    name: 'The Empty Watchtower',
    siteName: 'Wardstone Watch',
    mapKind: 'overland',
    theme: 'moor',
    level: 3,
    floors: 5,
    seed: 690255,
    mapW: 76,
    mapH: 76,
    place: 'Wardstone Watch',
    locType: 'Watchtower',
    finalBossId: 'wight',
    finalBossName: 'Captain Aldis Vane',
    bossArt: './art/ch3_vane.webp',
    bossArtLabel: 'Still in the livery of a crown that stopped paying her.',
    bossHpMult: 2.5,
    rewardGold: 480,
    rewardXp: 460,
    rewardItem: null,
    itemLevel: 3,

    /* Floor 1: the moor and the tower grounds — scavengers, nothing worse.
       Floor 2: the stair. Undead, and they are all wearing the same livery. */
    floorPlan: [
      {
        mapKind: 'overland', theme: 'moor', name: 'Wardstone Watch — The Approach',
        mapW: 70, mapH: 70,
        monsters: {
          1: ['stirge', 'swarm-of-rats', 'giant-badger', 'wolf', 'giant-owl'],
          2: ['dire-wolf', 'giant-spider', 'harpy'],
          3: ['owlbear']
        }
      },
      {
        mapKind: 'overland', theme: 'moor', name: 'Wardstone Watch — The Tower Grounds',
        mapW: 76, mapH: 76,
        monsters: {
          1: ['stirge', 'swarm-of-rats', 'giant-rat', 'giant-badger'],
          2: ['dire-wolf', 'harpy', 'giant-spider'],
          3: ['owlbear']
        }
      },
      {
        mapKind: 'dungeon', theme: 'ancient', name: 'Wardstone Watch — The Under-Stair',
        monsters: {
          1: ['skeleton', 'zombie', 'giant-rat', 'swarm-of-bats'],
          2: ['ghoul', 'specter', 'shadow'],
          3: ['ghast']
        }
      },
      {
        mapKind: 'dungeon', theme: 'ancient', name: 'Wardstone Watch — The Garrison Deep',
        monsters: {
          1: ['skeleton', 'zombie', 'swarm-of-bats'],
          2: ['ghoul', 'specter', 'shadow', 'will-o-wisp'],
          3: ['ghast', 'wight']
        }
      },
      {
        mapKind: 'dungeon', theme: 'ancient', name: 'Wardstone Watch — Where They Went',
        monsters: {
          1: ['skeleton', 'zombie'],
          2: ['ghoul', 'specter', 'shadow', 'will-o-wisp'],
          3: ['wight', 'ghast', 'deep-dwarf-death-knight'],
          boss: ['wight']
        }
      }
    ],

    description:
      'The watchtowers along the old frontier stand empty — every crown blames every ' +
      'other crown for the pay that stopped coming. Wardstone Watch is different. Its ' +
      'garrison was paid, provisioned, and at full strength, and it is still empty. ' +
      'Find out where sixteen soldiers went. The answer is under the tower, down a ' +
      'stair that no watchtower in the world was built with.',
    embarkText:
      'Wardstone Watch stands alone on the moor with its gate open and its banner still ' +
      'flying. No bodies. No blood. No sign of a fight anywhere on the grounds. The ' +
      'party walks in through a door that nobody barred.',
    victoryText:
      'Captain Vane goes down still wearing the livery of a crown that stopped paying ' +
      'her four years ago. Her people are laid out in the dark below in neat rows, ' +
      'facing the same direction — down. The party climbs back into daylight with more ' +
      'questions than it brought.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: true,

    storyChallenges: [
      {
        floor: 3,
        zone: 'treasure',
        challenge: {
          name: 'The Mess Table', type: 'room', reward: { kind: 'gold' },
          desc: 'Down in the garrison deep, a long table laid for sixteen — plates, cups, a game of cards paused mid-hand. Four years of dust and not one chair knocked over.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk', backdrop: './art/ch3_messtable.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Read the table',
              win: 'They ate, they stacked their plates, they pushed in their chairs, they walked down. Orderly to the last — and the mess fund is still in its tin.',
              lose: 'Dust says nothing except how long. You already knew how long.' },
            { tier: 'standard', skill: 'insight', label: 'Read the card hands',
              win: 'The dealer was winning and left the pot. Nobody leaves a winning pot for a bad reason — they went down GLAD. That pot pays for the party’s trouble.',
              lose: 'Cards are cards. The pot is pewter buttons.' },
            { tier: 'risky', skill: 'sleightOfHand', label: 'Check under the table', failEffect: 'alert',
              win: 'A strongbox strapped under the boards — the serjeant’s discretionary fund, untouched by whatever discretion took them.',
              lose: 'The strap was a wire. The wire was a bell. The dark takes notice.' }
          ]
        }
      },
      {
        floor: 5,
        zone: 'entrance',
        challenge: {
          name: 'The Roll of Sixteen', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'The last landing. Sixteen sets of kit, folded and stacked against the wall with parade precision. They undressed for something. Vane’s captain’s sash lies on top.',
          visuals: { props: ['./dcss/item/armor/feet/boots_1_brown_new.png'], heroAnim: 'spellcast', backdrop: './art/ch3_kitroll.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Name each of the sixteen',
              win: 'You read each name-tape aloud, once, into the dark. Whatever is left of them down here hears its name in a living voice — and the dark feels less hungry for it.',
              lose: 'Half the tapes are rotted. A half-called roll is worse than none.' },
            { tier: 'standard', skill: 'history', label: 'Piece together the order they went',
              win: 'Youngest first, officers last, Vane at the very end — she watched every one of her people through before she followed. Whatever waits below still thinks like a soldier.',
              lose: 'The stack order tells you nothing you can use.' },
            { tier: 'risky', skill: 'persuasion', label: 'Speak to Vane before you see her', failEffect: 'frighten',
              win: 'You say what you came to say to the empty sash — that her serjeant paid for this, that somebody still musters her name. The thing wearing her rank will hear it differently. Every edge helps.',
              lose: 'The dark says her words back to you, in her voice, before you’ve finished. You were not ready for that.' }
          ]
        }
      },
      {
        floor: 1,
        zone: 'entrance',
        challenge: {
          name: 'The Unbarred Door', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'The tower gate stands open from the inside. Sixteen bunks, sixteen kits, boots still under the beds. Whatever happened here, nobody packed and nobody fought.',
          visuals: { props: ['./dcss/item/armor/feet/boots_1_brown_new.png'], heroAnim: 'walk', backdrop: './art/ch3_unbarred.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Count the beds',
              win: 'Sixteen bunks, sixteen kits, and every weapon still on its peg. They went down unarmed. That takes trust, or orders.',
              lose: 'The barracks has been picked over by weather and birds. Nothing reads clean.' },
            { tier: 'standard', skill: 'investigation', label: 'Read the duty roster',
              win: 'The roster runs unbroken for four years, then stops mid-week — no desertions, no gaps. The last entry is in the captain’s hand and it just says: RELIEVED.',
              lose: 'Damp has taken the ledger. The pages come apart in your fingers.' },
            { tier: 'risky', skill: 'religion', label: 'Read the shrine-offerings', failEffect: 'frighten',
              win: 'They left offerings before they went — all sixteen, all the same rite, all for safe passage DOWNWARD. They knew exactly where they were going, and they went anyway.',
              lose: 'You get far enough into the rite to feel what answered it, and wish you hadn’t.' }
          ]
        }
      },
      {
        floor: 2,
        zone: 'combat:2',
        challenge: {
          name: 'The Wrong Stair', type: 'room', reward: { kind: 'shortcut' },
          desc: 'Under the tower cellar, the flagstones give way to a spiral stair — and the masonry changes. The tower is fieldstone and mortar. This is dressed ashlar, cut to a tolerance nobody on this frontier can manage, and it goes down a long way.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'walk', backdrop: './art/ch3_wrongstair.webp' },
          approaches: [
            { tier: 'safe', skill: 'arcana', label: 'The masonry isn’t local',
              win: 'No tool marks, no seams, no settling in a thousand years. This stair was not built into the ground — the ground was built around it.',
              lose: 'Stone is stone. Whatever’s strange about it stays strange.' },
            { tier: 'standard', skill: 'investigation', label: 'Which way was it built to carry?',
              win: 'The treads are worn — but only on the leading edge, and only going UP. Whatever used this stair for a thousand years was climbing.',
              lose: 'The wear is too even to read anything into.' },
            { tier: 'risky', skill: 'athletics', label: 'Force the jammed landing-door', failEffect: 'damage',
              win: 'The door gives at the third shoulder and opens onto a landing that shortcuts half the descent.',
              lose: 'The door doesn’t give. Your shoulder does.' }
          ]
        }
      },
      {
        floor: 4,
        zone: 'shrine',
        challenge: {
          name: 'Garrison Shrine, Still Lit', type: 'room', reward: { kind: 'buffEffect', buffKey: 'sacredWeapon' },
          desc: 'Four years on, the garrison’s shrine-lamp is still burning. There is no oil in the reservoir. There has not been oil in it for a long time.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'spellcast',
                     backdrop: './art/ch3_shrine.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Finish the rite they left unfinished',
              win: 'You speak the closing words nobody stayed to say. The lamp gutters, gratefully, and goes out — and something in the tower relaxes for the first time in four years.',
              lose: 'The rite is a soldier’s rite, in a soldier’s shorthand, and you are not a soldier.' },
            { tier: 'standard', skill: 'medicine', label: 'Examine what they left behind',
              win: 'The blood on the altar-cloth is four years old and was given a drop at a time, by sixteen people, in turn. Payment, not sacrifice. They were buying something.',
              lose: 'Too old and too degraded to tell you anything you can trust.' },
            { tier: 'risky', skill: 'arcana', label: 'Trace what the lamp is drawing on', failEffect: 'damage',
              win: 'The flame is fed from below — a thin thread of something running down the stair and out of sight. Follow it far enough and you would find whatever is on the other end. The party takes the thread’s measure and comes away armed with it.',
              lose: 'You put your hand into the current to feel where it runs, and it pulls back harder than you do.' }
          ]
        }
      }
    ],

    /* End-of-floor beats: the garrison didn't die or flee — it formed up and
       walked down, willingly, and paid its way. The first clear look at the
       Charter's true transaction, three chapters before anyone names it. */
    floorBeats: {
      1: {
        place: 'The Approach — swept',
        speaker: 'On the muster-ground',
        art: './art/ch3_fb1.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'No bodies, no graves, no sign of a fight anywhere on the approach. But the mud of the muster-ground outside the gate holds the whole story in bootprints — and it is not the story of a garrison overrun.',
            choices: [
              { label: 'Read the ranks', next: 'ranks' },
              { label: 'Count the directions', next: 'dirs' }
            ]
          },
          ranks: {
            text: 'Sixteen sets of prints, formed into ordered files, dressed and even. They stood parade here, in step, unhurried — and then marched. Nobody was dragged. Nobody broke ranks. They left the way soldiers march to inspection.',
            go: 'Marched where, though?'
          },
          dirs: {
            text: 'Every print leads inward, through their own open gate, toward the tower. Not one set comes back out. Sixteen soldiers walked in good order into a place they never walked out of, and barred nothing behind them.',
            go: 'Marched where, though?'
          }
        },
        challenge: {
          name: 'The Ordered March', nid: 'ch3_fb1', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A full garrison that formed up and marched inward in good order, and never marched out. Read what could command soldiers to do that willingly.',
          visuals: { props: ['./dcss/monster/human.png'], heroAnim: 'walk', backdrop: './art/ch3_fb1_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Read the formation',
              win: 'Discipline, not panic — a drill order, cleanly executed. They were told to muster and go, and every one of them obeyed as if it were a lawful command.',
              lose: 'Rain has softened the prints to guesswork. You can’t swear to the order of it.' },
            { tier: 'standard', skill: 'survival', label: 'Track the last man',
              win: 'The rearmost prints pause at the threshold — one soldier stopped, turned once to look back at the daylight, and then went in after the rest anyway.',
              lose: 'The trail dissolves at the gate. Whatever the last man felt, the mud won’t say.' },
            { tier: 'risky', skill: 'insight', label: 'Feel the shape of the order', failEffect: 'frighten',
              win: 'This wasn’t a rout or a spell of terror. It was summons — a pull they answered like duty, the way a charter is honoured. Something down there called in a debt.',
              lose: 'You reach for what moved them and touch the edge of it, and it is patient, and it notices you.' }
          ]
        }
      },
      2: {
        place: 'The Tower Grounds — swept',
        speaker: 'In the guardroom',
        art: './art/ch3_fb2.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'Everything in the tower is squared away — bunks made, kits stowed, a meal left half-eaten and gone to dust. And in the floor of the guardroom, where no watchtower has any business having one, is a stair going down.',
            choices: [
              { label: 'Examine the stair', next: 'stair' },
              { label: 'Look at how it fits the tower', next: 'fit' }
            ]
          },
          stair: {
            text: 'The steps are dressed stone, older than the mortar of the tower above, and their centres are worn into smooth hollows — by many feet, over long years, going down. The wear on the up-side of each step is almost none.',
            go: 'People came here to descend. Not to return.'
          },
          fit: {
            text: 'The tower doesn’t own this stair — it was built on top of it. Someone raised a garrison here specifically to sit over this hole, to watch it, or to feed it. The watchtower was always the lid.',
            go: 'And now the lid is empty.'
          }
        },
        challenge: {
          name: 'The Stair Beneath the Tower', nid: 'ch3_fb2', type: 'room', reward: { kind: 'shortcut' },
          desc: 'A worn descending stair the watchtower was built to cover, its steps hollowed by feet that only ever went down. Work out what the garrison was really posted here to do.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'walk', backdrop: './art/ch3_fb2_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Read the wear on the steps',
              win: 'Every hollow is worn on the descending edge. Whatever this garrison’s duty was, it was measured in journeys down — and almost none back up.',
              lose: 'Stone wears how it wears. You can’t make the steps confess.' },
            { tier: 'standard', skill: 'history', label: 'Date the buried stair',
              win: 'The stair predates the kingdom that manned it. Crown after crown inherited this post, paid it, and never wrote down what it was actually guarding.',
              lose: 'No chronicle you know admits this stair exists. Which tells you something by itself.' },
            { tier: 'risky', skill: 'athletics', label: 'Sound the depth below', failEffect: 'damage',
              win: 'A dropped stone falls a long, long time before it lands. This isn’t a cellar. It’s a throat, and the garrison went all the way down it.',
              lose: 'You lean too far into the dark to listen, and the worn stone nearly takes you down with your answer.' }
          ]
        }
      },
      3: {
        place: 'The Under-Stair — swept',
        speaker: 'On the descent',
        art: './art/ch3_fb3.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The stair goes down through stone older than any kingdom, and the garrison marked its passage — not with blood, but with belongings. Their kit lies laid aside on the steps, in order, deeper and deeper down.',
            choices: [
              { label: 'Read the order of it', next: 'order' },
              { label: 'Handle what they left', next: 'left' }
            ]
          },
          order: {
            text: 'Weapons first, near the top — swords, spears, bows, set down neatly against the wall. Then, further down, armour: mail, helms, greaves, unbuckled and stacked. Then boots. They shed their soldiering step by step as they descended.',
            go: 'Undressing for what?'
          },
          left: {
            text: 'Nothing is thrown or dropped. Everything is placed — squared to the wall, laid out with care, the way you set down what you won’t need where someone tidy will find it. They disarmed the way pilgrims do at a threshold.',
            go: 'Undressing for what?'
          }
        },
        challenge: {
          name: 'What They Set Down', nid: 'ch3_fb3', type: 'room', reward: { kind: 'tempHp' },
          desc: 'A garrison’s arms and armour laid aside in careful order down a descending stair, each soldier shedding their soldiering the deeper they went. Understand what asks that of the living.',
          visuals: { props: ['./dcss/item/armor/torso/plate_mail_1.png'], heroAnim: 'spellcast', backdrop: './art/ch3_fb3_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'medicine', label: 'Examine the laid-aside kit',
              win: 'No blood on any of it, no haste in the placing. These were healthy soldiers who calmly decided their weapons were no longer the point of the journey.',
              lose: 'Dust and old leather. It tells you nothing a frightened mind won’t invent.' },
            { tier: 'standard', skill: 'religion', label: 'Read it as a rite',
              win: 'This is a divestment — the shedding of worldly office before an altar. They went down not as a garrison but as supplicants, offering the only thing soldiers have: themselves.',
              lose: 'The shape of a rite is here, but its god is one no scripture of yours would name.' },
            { tier: 'risky', skill: 'insight', label: 'Walk it as they walked it', failEffect: 'frighten',
              win: 'Step by step you feel the pull that unarmed them — a certainty, warm and terrible, that where they were going, resistance would be not just useless but rude. It nearly convinces you too.',
              lose: 'You put yourself on their steps and their calm reaches up for you, and for a moment your own hands want to set your sword down.' }
          ]
        }
      },
      4: {
        place: 'The Garrison Deep — swept',
        speaker: 'At the deep landing',
        art: './art/ch3_fb4.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'At the bottom of the long descent, before the last dark, the sixteen left one thing more. Not their bodies — those lie further in, in rows, facing down. Here on the landing they left their pay, stacked with care.',
            choices: [
              { label: 'Examine the stacked pay', next: 'pay' },
              { label: 'Read why they left it', next: 'why' }
            ]
          },
          pay: {
            text: 'Coin in neat towers. Service-rings threaded on a cord. Bronze muster-tokens, a captain’s seal, four years of a garrison’s unspent wages — all placed deliberately at the threshold like coins laid on a temple step.',
            go: 'A toll. Freely paid.'
          },
          why: {
            text: 'Nobody robbed them. Nobody had to. They brought their pay down here and set it out as an offering — the price of admission to whatever is below, rendered gladly, as if the wage was always meant to end up here.',
            go: 'As if this was always the deal.'
          }
        },
        challenge: {
          name: 'The Toll They Paid', nid: 'ch3_fb4', type: 'room', reward: { kind: 'item' },
          desc: 'A garrison’s four years of unspent wages, stacked as a willing offering at the threshold of the dark. Read what bargain a crown’s soldiers thought they were settling.',
          visuals: { props: ['./dcss/item/gold/gold_pile.png'], heroAnim: 'walk', backdrop: './art/ch3_fb4_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'history', label: 'Tally the offering',
              win: 'Every token accounted for — this is a full garrison’s worth, to the last coin, rendered complete. Whatever they were paying for, they paid it in full and thought it fair.',
              lose: 'You can price the metal but not the meaning. The sum stays senseless.' },
            { tier: 'standard', skill: 'religion', label: 'Read the offering-rite',
              win: 'A toll, laid the way the old rites lay a coin for a crossing. They believed they owed this — that their service, and now their coin, and now themselves, were a debt coming due at the bottom of the stair.',
              lose: 'The rite’s shape is here but you can’t hear who it was addressed to.' },
            { tier: 'risky', skill: 'persuasion', label: 'Ask the dead what they bought', failEffect: 'frighten',
              win: 'You speak the old words over the offering, and the shape of the bargain comes clear: a seal, fed on service, and a garrison who were told their deaths would hold something shut. They went gladly. That is the horror of it.',
              lose: 'You call on the dead for terms, and something at the bottom of the stair answers in their place.' }
          ]
        }
      }
    },

    briefing: {
      speaker: 'Serjeant Weyl, Frontier Muster',
      portrait: null,
      art: './art/ch3_briefing.webp',
      start: 'root',
      nodes: {
        root: {
          text: 'Sixteen of mine at Wardstone. Paid on time, victualled through winter, no complaints on record. Then nothing — four years of nothing, and the crown won’t send anyone to look because looking costs money and the tower’s already written off. So I’m paying you out of my own purse. Ask what you like.',
          choices: [
            { label: '“Who was in command?”', next: 'captain' },
            { label: '“Deserters, surely.”', next: 'deserters' },
            { label: '“What’s under the tower?”', next: 'under' },
            { label: '“We’ll find your sixteen. We march.”', setOut: true }
          ]
        },
        captain: {
          text: 'Aldis Vane. Twenty-two years, never lost a post, never lost a soldier she didn’t bury herself. If Vane walked her garrison off that tower she had a reason, and if she had a reason it was a good one. That’s what frightens me. Not that they left. That she led them.',
          choices: [
            { label: '“What else?”', next: 'root' },
            { label: '“Then we’ll ask her ourselves. We march.”', setOut: true }
          ]
        },
        deserters: {
          text: 'Deserters take their boots. Deserters take their PAY. There’s four years of unclaimed silver in that strongroom and the door’s not even forced. Whatever they went to do, they didn’t think they’d need money for it. Take the tower key — save you breaking anything.',
          effect: { flag: 'scouted' },
          choices: [
            { label: '“Fair. What else?”', next: 'root' },
            { label: '“We’ll open it properly, then. We march.”', setOut: true }
          ]
        },
        under: {
          text: 'Nothing’s under it. That’s the point — I signed the build order myself, nineteen years back. Fieldstone tower, timber floor, root cellar eight foot deep. If you find a stair down there, then somebody dug it after, or it was there before the tower and we put a watchtower on top of it without knowing. I don’t like either answer. Here — you’ll want the light.',
          effect: { potion: 'heal' },
          choices: [
            { label: '“We’ll tell you which it is.”', next: 'root' },
            { label: '“Then we go down and see. We march.”', setOut: true }
          ]
        }
      }
    }
  },

  /* ================= CHAPTER IV ================================
     The trap, dressed as a reward. Warm, bright, ceremonial — the only
     chapter in the arc where nothing tries very hard to kill the party. The
     Guild signs them, and the contract has a clause. The `investigation`
     branch of The Signing is the arc's single most important optional beat:
     it's the one chance to read the seal-language in Act I, and it sets
     `read_charter` for callbacks in Ch5, Ch11 and Ch20. */
  {
    id: 'story_ch4',
    story: true,
    chapter: 4,
    name: 'Charter and Seal',
    siteName: 'Charterhall Proving-ground',
    mapKind: 'overland',
    theme: 'holdfast',
    level: 4,
    floors: 5,
    seed: 213996,
    mapW: 68,
    mapH: 68,
    place: 'Charterhall',
    locType: 'Proving-ground',
    finalBossId: 'owlbear',
    finalBossName: 'the proving-bout',
    bossArt: './art/ch4_owlbear.webp',
    bossArtLabel: 'This is not a fight. It is a performance, and the crowd has paid.',
    bossHpMult: 1.4,
    rewardGold: 700,
    rewardXp: 620,
    rewardItem: null,
    itemLevel: 4,

    /* Deliberately trivial: this is the Guild's caged training stock, and the
       fight is a SHOW. If the player notices the enemies are soft, good —
       they're supposed to feel flattered and slightly patronised. */
    monsterRoster: {
      1: ['goblin', 'kobold', 'giant-rat', 'wandering-mushroom', 'gray-ooze'],
      2: ['hobgoblin', 'thug', 'giant-spider'],
      3: ['owlbear'],
      boss: ['owlbear']
    },

    /* Five proving rounds on small holdfast yards — deliberately the tightest
       maps in the campaign (this is a tournament, not a march), each round's
       stock a little less trivial than the last. */
    floorPlan: [
      { mapKind: 'overland', theme: 'holdfast', name: 'Charterhall — The Signing Yard',
        mapW: 56, mapH: 56, zones: 7,
        monsters: { 1: ['giant-rat', 'goblin', 'wandering-mushroom'] } },
      { mapKind: 'overland', theme: 'holdfast', name: 'Charterhall — The Memorial Walk',
        mapW: 56, mapH: 56, zones: 7,
        monsters: { 1: ['goblin', 'kobold', 'gray-ooze'], 2: ['giant-spider'] } },
      { mapKind: 'overland', theme: 'holdfast', name: 'Charterhall — The Quartermaster’s Row',
        mapW: 60, mapH: 60, zones: 8,
        monsters: { 1: ['goblin', 'kobold'], 2: ['hobgoblin', 'thug'] } },
      { mapKind: 'overland', theme: 'holdfast', name: 'Charterhall — The Betting Ring',
        mapW: 60, mapH: 60, zones: 8,
        monsters: { 1: ['kobold'], 2: ['hobgoblin', 'thug', 'giant-spider'], 3: ['bugbear'] } },
      { mapKind: 'overland', theme: 'holdfast', name: 'Charterhall — The Proving Ring',
        mapW: 64, mapH: 64, zones: 8,
        monsters: { 1: ['goblin'], 2: ['hobgoblin', 'thug'], 3: ['bugbear'],
                    boss: ['owlbear'] } }
    ],

    description:
      'Word travels. A company that clears a warcamp, walks Longbarrow Moor, and comes ' +
      'back from Wardstone with an answer is a company worth having on the books — and ' +
      'the Adventurers’ Charter would like your names on theirs. There is a ceremony. ' +
      'There is a proving-bout, for the crowd. There is a contract, and it is very long, ' +
      'and nobody expects you to read it.',
    embarkText:
      'Charterhall is the first place in a month with walls that aren’t falling down. ' +
      'Banners, a cook-fire the size of a cottage, and two hundred people who want to ' +
      'buy the company a drink. Somebody has already chalked your names on the board.',
    victoryText:
      'The bout is won, the crowd is loud, and the ink is dry. The company is Chartered. ' +
      'Somewhere in the hall behind the cheering, a clerk files a fresh page into a ' +
      'ledger, in a room where the lamps burn without oil.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: false,

    storyChallenges: [
      {
        floor: 3,
        zone: 'treasure',
        challenge: {
          name: 'The Quartermaster’s Gauntlet', type: 'room', reward: { kind: 'item' },
          desc: 'Between rounds, the Charter’s quartermaster runs a sideshow: a stocked kit-wagon, and any company that can get a hand on it keeps what it grabs. There is, of course, a catch per axle.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk', backdrop: './art/ch4_quartermaster.webp' },
          approaches: [
            { tier: 'safe', skill: 'acrobatics', label: 'Thread the rigged course',
              win: 'Buckets, ropes, and one indignant goose later, a hand lands flat on the wagon rail. The quartermaster pays up with professional respect.',
              lose: 'The goose wins. The crowd will be retelling this for years.' },
            { tier: 'standard', skill: 'sleightOfHand', label: 'Palm something mid-fumble',
              win: 'You trip theatrically, apologise handsomely, and stand up richer. The quartermaster saw — and pays double for the artistry.',
              lose: 'The quartermaster has watched ten thousand pickpockets. You are not the exception.' },
            { tier: 'risky', skill: 'athletics', label: 'Go straight over the top', failEffect: 'damage',
              win: 'Over the barrels, through the tarp, onto the wagon bed — the direct approach, executed directly.',
              lose: 'The tarp was the trap. The barrels were also the trap. Everything was the trap.' }
          ]
        }
      },
      {
        floor: 4,
        zone: 'combat',
        challenge: {
          name: 'The Betting Ring', type: 'room', reward: { kind: 'gold' },
          desc: 'The odds-board by the fourth yard lists tomorrow’s bout. The company’s name is there — at odds that say the bookmakers know something about the owlbear that the handlers aren’t saying.',
          visuals: { props: ['./dcss/item/misc/misc_crystal.png'], heroAnim: 'walk', backdrop: './art/ch4_bettingring.webp' },
          approaches: [
            { tier: 'safe', skill: 'insight', label: 'Read the bookmakers',
              win: 'The odds aren’t about the beast at all — they’re about how companies FREEZE when the cage opens. Forewarned, and a modest bet on yourselves pays nicely.',
              lose: 'Professional faces. The odds keep their secret.' },
            { tier: 'standard', skill: 'persuasion', label: 'Talk to the beast’s handlers',
              win: 'Ale in, truth out: the owlbear is blind on the left side and hates the smell of pitch. The handlers bet on you; so do you.',
              lose: 'The handlers are paid in Charter coin and stay bought.' },
            { tier: 'risky', skill: 'deception', label: 'Feign a limp and move the odds', failEffect: 'debuff',
              win: 'The company hobbles past the board looking half-dead, the odds lengthen beautifully, and the wager lands at the last window. Theatre pays.',
              lose: 'A Charter officer watches the limp switch legs mid-yard. There will be a note in a margin about this.' }
          ]
        }
      },
      {
        floor: 1,
        zone: 'entrance',
        challenge: {
          name: 'The Signing', type: 'room', reward: { kind: 'item' },
          desc: 'Nine pages of close-set clerk-hand, a pot of ink, and a smiling factor who has already dipped the pen for you. The crowd outside is chanting the company’s name. It would be very easy to sign.',
          visuals: { props: ['./dcss/item/scroll/scroll-brown.png'], heroAnim: 'spellcast',
                     backdrop: './art/ch4_signing.webp' },
          approaches: [
            { tier: 'safe', skill: 'persuasion', label: 'Negotiate the terms',
              win: 'You talk the factor up two grades of hazard pay and a resupply clause. He concedes it all instantly and without checking, which is either generosity or indifference to the cost.',
              lose: 'He is charming, immovable, and somehow you end up thanking him.' },
            { tier: 'standard', skill: 'investigation', label: 'Actually read it', effect: { flag: 'read_charter' },
              win: 'Page seven, clause forty-one, in the same hand as the rest: the signatory pledges "service in the deep places, in perpetuity, the term surviving the person." Surviving the person. You read it twice. The factor waits, still smiling, and does not stop you.',
              lose: 'The hand is deliberately dense and the crowd is deliberately loud. You get four pages in before the factor gently takes it back to "save you the trouble."' },
            { tier: 'risky', skill: 'intimidation', label: 'Demand to see what else you’re signing', failEffect: 'alert',
              win: 'You put a hand flat on the page and ask what the other copy is for. For half a heartbeat the factor’s smile is not there at all. Then it is back, and he tells you — a filing copy, for the vault at Marrowfen.',
              lose: 'You make a scene. The crowd loves it. The factor makes a small note in the margin that is not about the crowd.' }
          ]
        }
      },
      {
        floor: 2,
        zone: 'shrine',
        challenge: {
          name: 'The Long Roll', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'The memorial wall of the Charter: every company that ever signed, cut into slate, going back further than the Charter is supposed to be old. The list of the honoured dead is longer than the list of the living by a factor of about forty.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'spellcast', backdrop: './art/ch4_longroll.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Stand the remembrance',
              win: 'You stand the full rite with the Charter’s own priests. Whatever else this place is, the grief in it is real, and the party goes to the bout steadier for it.',
              lose: 'The rite is long, the day is hot, and the words don’t land.' },
            { tier: 'standard', skill: 'history', label: 'Read back through the names',
              win: 'The oldest names on the wall predate the Charter’s founding by two centuries. Somebody was signing companies into the deep long before there was a Guild to do the signing.',
              lose: 'The early slate is worn past reading, which is convenient.' },
            { tier: 'risky', skill: 'perception', label: 'Look for the pattern in the dates', failEffect: 'debuff',
              win: 'Company losses per year, cut in slate across four hundred years, and the number barely moves. Not a trend. Not a war. A quota — held level, year on year, like something is being paid.',
              lose: 'You stare at four hundred years of dead adventurers until the numbers swim, and get nothing from it but the weight.' }
          ]
        }
      },
      {
        floor: 5,
        zone: 'boss',
        challenge: {
          name: 'The Proving-Bout', type: 'room', reward: { kind: 'tempHp' },
          desc: 'A roped ring, a packed gallery, and something big and unhappy in a cage on the far side. This is not a fight. It is a performance, and the crowd has paid.',
          visuals: { props: ['./dcss/monster/animals/grizzly_bear.png'], heroAnim: 'slash', backdrop: './art/ch4_provingbout.webp' },
          approaches: [
            { tier: 'safe', skill: 'performance', label: 'Give the crowd its money’s worth',
              win: 'You play to the gallery, and the gallery roars, and the company fights the whole bout on a wave of noise.',
              lose: 'The flourish lands badly and the front row laughs. Fine. Do it the plain way.' },
            { tier: 'standard', skill: 'animalHandling', label: 'Read the beast before the cage opens',
              win: 'Half-starved, over-baited, and terrified — it will charge the loudest thing in the ring, and you know exactly where that is going to be.',
              lose: 'It is too worked-up to read. It will do whatever it does.' },
            { tier: 'risky', skill: 'insight', label: 'Watch the gallery instead of the ring', failEffect: 'frighten',
              win: 'While everyone else watches the beast, you watch the Charter’s officers watching YOU — not cheering, not betting. Assessing. One of them writes something down each time the party takes a hit.',
              lose: 'You take your eyes off a very large animal to look at a balcony. It costs you.' }
          ]
        }
      }
    ],

    /* End-of-floor beats: Charterhall is warm, generous and loud, and every
       floor the party is having a wonderful time noticing the machine under
       the party — a system that runs on companies exactly like theirs. */
    floorBeats: {
      1: {
        place: 'The Signing Yard — the party rolls on',
        speaker: 'By the bonfire',
        art: './art/ch4_fb1.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The yard is all warmth and noise — your names chalked huge on the board of new companies, cups pressed into your hands. But you catch a clerk at the board doing something quiet: wiping an old company’s name away to make room for yours.',
            choices: [
              { label: 'Watch the clerk work', next: 'clerk' },
              { label: 'Read the cleared name', next: 'name' }
            ]
          },
          clerk: {
            text: 'No ceremony to it. A damp rag, a practised wipe, a fresh company chalked in the same spot before the old letters have finished smearing. He’s done it a thousand times. The board only ever holds so many living names.',
            go: 'And the wiped ones?'
          },
          name: {
            text: 'Under your bright new letters, the ghost of the last company still shows — a good name, signed with pride not long ago, gone now with no black border and no toast. Just space, cleared, for the next.',
            go: 'And nobody at the party even looks up.'
          }
        },
        challenge: {
          name: 'The Cleared Board', nid: 'ch4_fb1', type: 'room', reward: { kind: 'gold' },
          desc: 'A roster board where the dead are wiped without ceremony to make room for the newly signed. Read what the Charter actually keeps count of.',
          visuals: { props: ['./dcss/item/scroll/scroll-brown.png'], heroAnim: 'walk', backdrop: './art/ch4_fb1_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Study the board’s turnover',
              win: 'The board is a ledger of churn: names in, names wiped, at a steady rate that has nothing to do with the celebration and everything to do with a business that expects most of its signatories not to last.',
              lose: 'It’s a busy board at a busy party. You can’t read doom into a bit of chalk.' },
            { tier: 'standard', skill: 'insight', label: 'Watch how the Charter men treat it',
              win: 'The officers glance at the board the way a farmer glances at stock — fondly, and without illusion. To them the wiping isn’t grief. It’s just the turn of the season.',
              lose: 'Everyone here is drunk and delighted, including, probably, you. Nothing reads as sinister.' },
            { tier: 'risky', skill: 'persuasion', label: 'Ask a clerk where the old names go', failEffect: 'debuff',
              win: 'A cup and a warm word, and the clerk says it plainly, cheerfully: "Oh, they go in the great roll downstairs, love. Every name we ever signed. None of them ever come off THAT one." He means it kindly.',
              lose: 'You press a little hard, a little sober, and the clerk’s smile cools. Word gets around that your company asks odd questions.' }
          ]
        }
      },
      2: {
        place: 'The Memorial Walk — swept',
        speaker: 'Along the slate wall',
        art: './art/ch4_fb2.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The memorial wall runs the length of the hall — every company the Charter ever lost, cut into slate, going back absurdly far. A mason is at work on it now, chisel tapping, adding fresh names to the honoured dead.',
            choices: [
              { label: 'Read over the mason’s shoulder', next: 'mason' },
              { label: 'Match a new name to the yard', next: 'match' }
            ]
          },
          mason: {
            text: 'He works from a list, unhurried, cutting names into the death-wall with the calm of a man filling in a form. He doesn’t wait for word that these companies have died. He’s simply been given the names, and the dates, ahead of time.',
            go: 'Ahead of time?'
          },
          match: {
            text: 'One name he’s halfway through carving belongs to a company you just watched toasting in the yard — alive, loud, whole. Their place on the death-wall is being prepared while they drink to their signing.',
            go: 'The memorial isn’t remembering. It’s scheduling.'
          }
        },
        challenge: {
          name: 'The Wall That Waits', nid: 'ch4_fb2', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A memorial wall being carved with the names of companies that are still alive. Work out how the Charter knows who to grieve before they die.',
          visuals: { props: ['./dcss/item/misc/misc_stone.png'], heroAnim: 'spellcast', backdrop: './art/ch4_fb2_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Read the mason’s worklist',
              win: 'Names and dates, in a neat clerkly hand, weeks and months out. He isn’t recording deaths. He’s working through a schedule of them, and the ink is barely dry on the signings.',
              lose: 'He shields the list, or you can’t make it out. Either way it stays his business.' },
            { tier: 'standard', skill: 'history', label: 'Read the wall’s true age',
              win: 'The wall goes back further than the Charter is supposed to exist, and the death-rate cut into it is horribly steady — a constant harvest, century upon century, dressed up as remembrance.',
              lose: 'Old slate and a lot of names. You can’t make it mean more than sorrow.' },
            { tier: 'risky', skill: 'insight', label: 'Ask the mason how he knows', failEffect: 'debuff',
              win: 'He shrugs, kind and tired: "They give me the names when they sign, not when they fall. Saves a second trip." He thinks that’s efficiency. It is the whole horror of the Charter in one sentence.',
              lose: 'The mason marks you for the sort who upsets the guests, and sets down his chisel until you leave.' }
          ]
        }
      },
      3: {
        place: 'The Quartermaster’s Row — swept',
        speaker: 'At the outfitter’s tables',
        art: './art/ch4_fb3.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The Charter’s generosity keeps coming — fine gear pressed on the company across the outfitter’s tables, "with our compliments." But every gift is weighed, tallied, and written into a great ledger before it’s handed over.',
            choices: [
              { label: 'Read the ledger', next: 'ledger' },
              { label: 'Weigh a "gift" in your hand', next: 'gift' }
            ]
          },
          ledger: {
            text: 'Every item is entered against your company’s name — not as a gift at all, but as an advance, charged at a generous valuation, to be settled out of earnings you haven’t made yet. You’re being outfitted into debt, warmly.',
            go: 'A gilded rope.'
          },
          gift: {
            text: 'Good steel, honest make — and stamped, like everything here, with the Charter sigil. It isn’t yours. It’s issued to you, on the books, and the books belong to them. You’ll carry their mark into the dark and owe them for the privilege.',
            go: 'Everything here has a price you didn’t see agreed.'
          }
        },
        challenge: {
          name: 'The Generous Ledger', nid: 'ch4_fb3', type: 'room', reward: { kind: 'item' },
          desc: 'Lavish "gifts" of gear, each quietly entered as a debt against earnings not yet made. Read the true terms of the Charter’s open hand.',
          visuals: { props: ['./dcss/item/book/book_gray.png'], heroAnim: 'walk', backdrop: './art/ch4_fb3_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Total the company’s account',
              win: 'Between gear, lodging and the fee for signing itself, your company is already deep in the Charter’s debt before its first chartered step — a debt only dangerous work can ever clear.',
              lose: 'The columns are dense and the wine is good. The sum slips away from you.' },
            { tier: 'standard', skill: 'insight', label: 'Read the quartermaster’s smile',
              win: 'He’s not cheating you — that’s the point. It’s all above board, all generous, all designed so a company must keep taking Charter work to stay ahead of Charter kindness. The trap is the arithmetic, not the man.',
              lose: 'He’s so pleasant and so helpful that suspicion feels like bad manners.' },
            { tier: 'risky', skill: 'sleightOfHand', label: 'Copy a page of the ledger', failEffect: 'alert',
              win: 'You palm a torn page: the standard terms, in black and white — advances, valuations, the interest of simply being alive on the Charter’s books. Evidence, for when someone finally wants it.',
              lose: 'A clerk sees your hand where it shouldn’t be. Nothing is said. Everything is noted.' }
          ]
        }
      },
      4: {
        place: 'The Betting Ring — swept',
        speaker: 'At the odds-board',
        art: './art/ch4_fb4.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The proving-ring draws a roaring crowd and a brisk trade in wagers. But standing at the odds-board a moment, you start to see the shape of it — and the house is not gambling. The house never gambles.',
            choices: [
              { label: 'Study the odds', next: 'odds' },
              { label: 'Watch the beast-handlers', next: 'handlers' }
            ]
          },
          odds: {
            text: 'The odds are set so the crowd always half-wins and always half-pays, and the Charter clips every wager either way. Nobody in the ring is meant to die and nobody is meant to walk away clean. It’s calibrated. It’s a mill.',
            go: 'Calibrated for what?'
          },
          handlers: {
            text: 'The handlers pick the proving-beasts with care — big enough to scar and terrify, chosen NOT to kill. A company must survive the bout to keep signing, keep earning, keep betting. Even the danger is managed to keep you in the machine.',
            go: 'They’re not trying to kill us. They’re trying to keep us.'
          }
        },
        challenge: {
          name: 'The House Never Loses', nid: 'ch4_fb4', type: 'room', reward: { kind: 'shortcut' },
          desc: 'A proving-ring calibrated so companies are scarred but survive, and the house clips every wager. Read what the whole cheerful spectacle is really for.',
          visuals: { props: ['./dcss/item/gold/gold_pile.png'], heroAnim: 'slash', backdrop: './art/ch4_fb4_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Track the money’s flow',
              win: 'Every coin bet, won or lost, leaves a clip in the Charter’s hand. The crowd thinks it’s the players. It’s the stakes. The whole roaring room is quietly feeding one account.',
              lose: 'Too much noise, too many hands, too fast. The flow blurs.' },
            { tier: 'standard', skill: 'insight', label: 'Read the spectacle’s purpose',
              win: 'It’s theatre with a ledger behind it: glory enough to keep companies signing, danger enough to keep them earning, mercy enough to keep them alive to do it again. A managed appetite, dressed as a festival.',
              lose: 'It reads as exactly what it pretends to be — a grand, generous, harmless good time.' },
            { tier: 'risky', skill: 'persuasion', label: 'Get a bookmaker talking', failEffect: 'debuff',
              win: 'A drink loosens him: "Kill a company and you lose a customer, don’t you? We don’t want you dead, friend. We want you BACK." He laughs. It is the kindest, worst thing anyone says to you all night.',
              lose: 'He clams up and flags a steward. Your company is getting a reputation before it’s earned one.' }
          ]
        }
      }
    },

    briefing: {
      speaker: 'Factor Emeric Sallow, Adventurers’ Charter',
      portrait: null,
      art: './art/ch4_briefing.webp',
      start: 'root',
      nodes: {
        root: {
          text: 'Four jobs, four returns, no losses. Do you know how rare that is? I have watched two hundred companies sign this book and I have watched most of them come off it inside a year. The Charter would like you on the rolls — proper pay, proper resupply, proper standing. Ask me anything. I have all afternoon and none of it is more important than you.',
          choices: [
            { label: '“What does the Charter actually get out of us?”', next: 'whatfor' },
            { label: '“Why so generous?”', next: 'generous' },
            { label: '“What happened at Wardstone. Do you know?”', next: 'wardstone' },
            { label: '“Where do we sign?”', setOut: true }
          ]
        },
        whatfor: {
          text: 'Contracts, principally. The crowns won’t garrison the frontier but they’ll pay a fee to say it’s handled, and we hand the work to companies like yours and take a cut. It is not romantic. It has kept the borderlands from going under for four hundred years, which I’d argue is better than romantic.',
          choices: [
            { label: '“Four hundred years?”', next: 'generous' },
            { label: '“Honest enough. Where do we sign?”', setOut: true }
          ]
        },
        generous: {
          text: 'Because you are worth it and because I would rather you took our coin than someone else’s. There are — other arrangements available to a company of your quality, and I would prefer you didn’t go looking for them. Here. Hazard advance, on account, before you’ve done anything to earn it. Call it faith.',
          effect: { gold: 250 },
          choices: [
            { label: '“What other arrangements?”', next: 'whatfor' },
            { label: '“We’ll take the faith. Where do we sign?”', setOut: true }
          ]
        },
        wardstone: {
          text: '…Vane. Yes. That was a bad business and I won’t pretend otherwise. She was Chartered, you know — nearly twenty years on our books. Whatever she went down there to do, she did it as one of ours. Which is why I would rather the next company that goes into a hole like that goes with our backing, our supply, and our people knowing where they are. Take this. It was hers.',
          effect: { flag: 'vane_token' },
          choices: [
            { label: '“You knew her.”', next: 'root' },
            { label: '“Then we’ll carry it properly. Where do we sign?”', setOut: true }
          ]
        }
      }
    }
  },

  /* ================= CHAPTER V — ACT BREAK ======================
     The first real dungeon of the arc, and it's earned: the fen approach is
     overland, but the vault itself has to be a crypt. The retrieval is a lie
     — the "relic" is the Charter's ledger, and the party's own name is in it,
     dated, with a figure beside it. If `read_charter` was set in Ch4, the
     player already knows what the figure means. */
  {
    id: 'story_ch5',
    story: true,
    chapter: 5,
    name: 'The Vault at Marrowfen',
    siteName: 'Marrowfen',
    mapKind: 'overland',
    theme: 'mire',
    level: 5,
    floors: 5,
    seed: 385140,
    mapW: 88,
    mapH: 84,
    place: 'Marrowfen',
    locType: 'Vault',
    finalBossId: 'death-knight',
    finalBossName: 'the Vault Warden',
    bossArt: './art/ch5_warden.webp',
    bossArtLabel: 'It was a person. It has not been relieved.',
    bossHpMult: 1.8,
    rewardGold: 950,
    rewardXp: 900,
    rewardItem: null,
    itemLevel: 5,

    floorPlan: [
      {
        mapKind: 'overland', theme: 'mire', name: 'Marrowfen — The Causeway',
        mapW: 88, mapH: 84,
        monsters: {
          1: ['giant-frog', 'giant-leech', 'stirge', 'swarm-of-insects', 'poisonous-snake', 'giant-centipede'],
          2: ['crocodile', 'giant-spider', 'oklob-plant', 'vine-stalker', 'giant-leech-swarm'],
          3: ['giant-constrictor-snake', 'black-pudding']
        }
      },
      {
        mapKind: 'overland', theme: 'mire', name: 'Marrowfen — The Reedbeds',
        mapW: 78, mapH: 78,
        monsters: {
          1: ['giant-frog', 'giant-leech', 'stirge', 'poisonous-snake', 'swarm-of-insects'],
          2: ['crocodile', 'oklob-plant', 'vine-stalker', 'giant-leech-swarm'],
          3: ['black-pudding', 'giant-constrictor-snake']
        }
      },
      {
        mapKind: 'dungeon', theme: 'grim', name: 'Marrowfen — The Outer Vault',
        monsters: {
          1: ['skeleton', 'zombie', 'swarm-of-bats'],
          2: ['ghoul', 'specter', 'shadow'],
          3: ['ghast', 'ogre-zombie']
        }
      },
      {
        mapKind: 'dungeon', theme: 'grim', name: 'Marrowfen — The Filing Vault',
        monsters: {
          1: ['skeleton', 'zombie', 'swarm-of-bats'],
          2: ['ghoul', 'specter', 'shadow', 'ogre-zombie'],
          3: ['ghast', 'wight']
        }
      },
      {
        mapKind: 'dungeon', theme: 'grim', name: 'Marrowfen — The Warden’s Door',
        monsters: {
          1: ['skeleton', 'zombie'],
          2: ['ghoul', 'specter', 'shadow', 'ogre-zombie'],
          3: ['ghast', 'wight', 'death-knight'],
          boss: ['death-knight']
        }
      }
    ],

    description:
      'Your first Chartered contract, and it is a simple retrieval: a sealed case, held ' +
      'in a Charter vault under the drowned country at Marrowfen, to be brought back ' +
      'unopened. The fee is four times what Greenrise paid. The instruction not to open ' +
      'it is repeated three times in a one-page brief. Everything else about the job is ' +
      'described in a single sentence.',
    embarkText:
      'The causeway to Marrowfen is a foot under black water and has been for a century. ' +
      'The party wades in a line, poling for the stones, while the mist closes up behind ' +
      'them like a door.',
    victoryText:
      'The Warden falls apart around a breastplate stamped with a Charter sigil, and the ' +
      'case comes open in the party’s hands because there was never a lock on it — only ' +
      'an instruction. Inside is no relic. It is a ledger: companies, dates, and a figure ' +
      'beside each name. Yours is already entered. The date is not today’s. It is later.',
    phases: [],
    sideObjectives: [],
    chain: null,
    bossIntel: true,

    storyChallenges: [
      {
        floor: 2,
        zone: 'shrine',
        challenge: {
          name: 'The Sunken Bell', type: 'room', reward: { kind: 'buffEffect', buffKey: 'sacredWeapon' },
          desc: 'A chapel drowned to its rafters, and in the reeds beside it, its bell — mouth-up, full of black water, still consecrated under the slime.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'spellcast', backdrop: './art/ch5_sunkenbell.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Ring it once, properly',
              win: 'Struck through the water, the note comes out low and whole and rolls across the whole fen. Everything sacred left in Marrowfen wakes up on the party’s side.',
              lose: 'The clapper is rusted fast. The bell keeps its silence.' },
            { tier: 'standard', skill: 'arcana', label: 'Read the founding blessing',
              win: 'The consecration was cut into the bronze, and bronze doesn’t rot. You trace the old words and they take hold of every blade present.',
              lose: 'The inscription circles the bell — the last third is buried in peat.' },
            { tier: 'risky', skill: 'athletics', label: 'Right the bell and hang it', failEffect: 'damage',
              win: 'Half a ton of bronze, four sets of shoulders, one improvised gallows of causeway timber — and Marrowfen has a bell again. It sounds like defiance.',
              lose: 'The peat gives. The bell decides to visit the bottom of the fen after all.' }
          ]
        }
      },
      {
        floor: 3,
        zone: 'combat',
        challenge: {
          name: 'The Archivist’s Door', type: 'room', reward: { kind: 'shortcut' },
          desc: 'The outer vault’s service door, bricked over from the inside — sloppily, in haste, by someone using file-boxes as bricks. Somebody once wanted very much not to be followed through here.',
          visuals: { props: ['./dcss/item/misc/misc_lantern.png'], heroAnim: 'walk', backdrop: './art/ch5_archivist.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Find the weak course',
              win: 'Paper is not masonry. You find the box the whole bodge leans on, slide it free, and the wall unstacks itself politely.',
              lose: 'Whoever built it panicked THOROUGHLY. It holds.' },
            { tier: 'standard', skill: 'history', label: 'Read the file-boxes first',
              win: 'The bricked-up boxes are sixty years of vault rosters — including who was posted here, and who stopped being relieved. The way through, and a why.',
              lose: 'Mould took the labels. The wall stays a wall.' },
            { tier: 'risky', skill: 'athletics', label: 'Put a shoulder through it', failEffect: 'alert',
              win: 'One hit, a cloud of sixty-year-old paperwork, and a corridor that skips the long way round.',
              lose: 'The crash rolls down every corridor in the vault, and the vault rolls something back.' }
          ]
        }
      },
      {
        floor: 1,
        zone: 'combat',
        challenge: {
          name: 'The Drowned Causeway', type: 'room', reward: { kind: 'gold' },
          desc: 'Somewhere under the black water is a road. Off the road is peat deep enough to take a horse. The mist gives you about nine feet of warning about anything.',
          visuals: { props: ['./dcss/item/misc/misc_stone.png'], heroAnim: 'walk', backdrop: './art/ch5_causeway.webp' },
          approaches: [
            { tier: 'safe', skill: 'survival', label: 'Pole for the stones',
              win: 'Slow, cold, and correct. The party finds the road by feel and stays on it — and finds a century of dropped purses in the silt alongside.',
              lose: 'You lose the line twice and spend an hour finding it again.' },
            { tier: 'standard', skill: 'nature', label: 'Read the reeds',
              win: 'Reeds grow thin over stone and thick over peat. The road is legible from fifty paces once you know that, and so are the places travellers went in.',
              lose: 'The reeds are uniform, dense, and unhelpful in every direction.' },
            { tier: 'risky', skill: 'athletics', label: 'Wade it straight', failEffect: 'poison',
              win: 'Straight across, chest-deep, in half the time — and half the fen’s lost valuables come up on the way.',
              lose: 'Straight across means through the leech beds. The party arrives fast, and sick.' }
          ]
        }
      },
      {
        floor: 4,
        zone: 'treasure',
        challenge: {
          name: 'The Sealed Case', type: 'room', reward: { kind: 'item' },
          desc: 'The case sits alone on a plinth in a dry vault under a drowned fen. Iron-bound, unmarked, and heavier than it looks. The brief said three times: do not open it.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk',
                     backdrop: './art/ch5_case.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Examine it without touching',
              win: 'The case is old. The wax seal on it is not — it is this season’s, and it carries Factor Sallow’s own sigil. Somebody sealed this AFTER the party took the contract.',
              lose: 'Iron, wood, wax. It gives you nothing standing there.' },
            { tier: 'standard', skill: 'arcana', label: 'Sense what’s inside',
              win: 'No wards, no curse, no power in it at all. Whatever is in this box, it is not magical and it is not dangerous. It is just something they do not want read.',
              lose: 'The vault’s ambient sourness drowns out anything finer.' },
            { tier: 'risky', skill: 'sleightOfHand', label: 'Open it and reseal it clean', failEffect: 'alert',
              effect: { flag: 'read_ledger_early' },
              win: 'The seal lifts whole, the case opens, and there is no relic inside — only a ledger, and the company’s own name partway down a page, entered in a hand nobody has written yet. You close it. You reseal it. You say nothing, and the walk out is very quiet.',
              lose: 'The wax cracks across the sigil. It cannot be made to look untouched — and something in the dark below has been told.' }
          ]
        }
      },
      {
        floor: 5,
        zone: 'boss',
        challenge: {
          name: 'The Vault Warden', type: 'room', reward: { kind: 'tempHp' },
          desc: 'It was a person. The breastplate is Charter-issue, three sizes of dent in it, and the sigil at the collar is the same one on the wax. It has been standing at this door a long time and it has not been relieved.',
          visuals: { props: ['./dcss/monster/death_knight.png'], heroAnim: 'slash', backdrop: './art/ch5_wardendoor.webp' },
          approaches: [
            { tier: 'safe', skill: 'religion', label: 'Name what it used to be',
              win: 'You give it the closing words of the Charter’s own funeral rite. It does not stop. But it hesitates — and a Warden that hesitates is a Warden the party can take.',
              lose: 'The rite means nothing to whatever is left in there.' },
            { tier: 'standard', skill: 'history', label: 'Read the livery',
              win: 'Fourth Company of the Charter, struck from the rolls sixty years ago with full honours. Honoured, memorialised in slate at Charterhall — and posted down here ever since.',
              lose: 'The livery is too corroded to place.' },
            { tier: 'risky', skill: 'stealth', label: 'Take the door before it turns', party: true, failEffect: 'alert',
              win: 'The party is past it and through the vault door in the dark, and only has to fight it on the way out — with the case already in hand and the way already known.',
              lose: 'It was never asleep. It has not been asleep for sixty years.' }
          ]
        }
      }
    ],

    /* End-of-floor beats: the "simple retrieval" is anything but. Floor by
       floor the party finds the Charter has run this errand many times, keeps
       the way maintained, and files its dead ahead of schedule — culminating
       in a filing-vault that already has a shelf waiting for them. */
    floorBeats: {
      1: {
        place: 'The Causeway — swept',
        speaker: 'On the drowned road',
        art: './art/ch5_fb1.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The causeway has been a foot under black water for a century, the brief said — a forgotten road to a forgotten vault. But the marker-posts that keep you on the stones are not a century old. They are new, and they are stamped.',
            choices: [
              { label: 'Examine a marker-post', next: 'post' },
              { label: 'Judge the upkeep', next: 'upkeep' }
            ]
          },
          post: {
            text: 'Fresh-cut timber, iron-shod, driven deep — and burned into each one, the Charter sigil. The same mark on your contract, your gear, your gifts. Someone from the guild has been out here recently, tending the way to a place they told you no one goes.',
            go: 'Forgotten by whom, exactly?'
          },
          upkeep: {
            text: 'The road is drowned but the route is immaculate — posts replaced, a snapped one lying where it was swapped out last season. This "forgotten" causeway is maintained on a schedule. The Charter comes here. Often.',
            go: 'Forgotten by whom, exactly?'
          }
        },
        challenge: {
          name: 'The Tended Road', nid: 'ch5_fb1', type: 'room', reward: { kind: 'gold' },
          desc: 'Fresh Charter-stamped markers keeping a "forgotten" century-drowned road passable. Read how often the guild really comes to Marrowfen.',
          visuals: { props: ['./dcss/item/misc/misc_stone.png'], heroAnim: 'walk', backdrop: './art/ch5_fb1_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Read the posts’ ages',
              win: 'The posts run new to old down the causeway, replaced in sequence over years. This is a route walked again and again — a supply line to somewhere the Charter would rather you believed was abandoned.',
              lose: 'Bog eats timber at its own pace. You can’t date the posts you can see.' },
            { tier: 'standard', skill: 'investigation', label: 'Count how many have come this way',
              win: 'Old rope-scars on the posts, worn boot-stones set into the mud at intervals — this road has carried company after company out to the vault, and the traffic is all one direction: out.',
              lose: 'The mist and the water have scrubbed the count away.' },
            { tier: 'risky', skill: 'survival', label: 'Read the far bank for returns', failEffect: 'poison',
              win: 'Every trail leads to the vault. None of the old paths lead back. Whatever the Charter sends down this tended road, the road only ever takes it one way.',
              lose: 'You wade off the stones to read the reeds and the black peat closes cold around your legs.' }
          ]
        }
      },
      2: {
        place: 'The Reedbeds — swept',
        speaker: 'Among the reeds',
        art: './art/ch5_fb2.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'Off the causeway, in the black water and the tall dead reeds, you find the ones who came before. A company’s worth of drowned dead, sunk in the mire, and every scrap they wear carries the Charter’s mark.',
            choices: [
              { label: 'Examine the drowned', next: 'drowned' },
              { label: 'Look at what they carried', next: 'carried' }
            ]
          },
          drowned: {
            text: 'Charter-issue gear, Charter-stamped steel, the same generous outfitting your own company was given at Charterhall. They were sent, exactly as you were sent, on a simple retrieval. They are still here.',
            go: 'And the case?'
          },
          carried: {
            text: 'One of them still clutches it: an iron-bound case, unmarked, sealed with red wax — identical to the one you were sent to bring back unopened. They fetched theirs. They died in the reeds a mile from the vault, holding it.',
            go: 'The errand isn’t new. Only the company is.'
          }
        },
        challenge: {
          name: 'The Company Before', nid: 'ch5_fb2', type: 'room', reward: { kind: 'tempHp' },
          desc: 'A drowned company in Charter gear, one still clutching a sealed case exactly like your errand. Read what happened to the last hands sent to do this job.',
          visuals: { props: ['./dcss/monster/undead/skeletons/skeleton_humanoid_large.png'], heroAnim: 'walk', backdrop: './art/ch5_fb2_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'medicine', label: 'Read how they died',
              win: 'They drowned in flight, in the dark, scattering off the safe stones — the same blind panic that took the herds and the flock. Something out here unmakes the nerve to walk a straight road.',
              lose: 'A century of bog has left too little to question.' },
            { tier: 'standard', skill: 'investigation', label: 'Reconstruct their errand',
              win: 'Same brief, same case, same route as yours, a lifetime ago. They retrieved it and never made it home. The Charter simply signed another company and sent them for the same thing again.',
              lose: 'The evidence is drowned past reading. Only the shape of it remains.' },
            { tier: 'risky', skill: 'insight', label: 'Understand why they were expendable', failEffect: 'frighten',
              win: 'It lands cold: the retrieval was never the point. Sending companies out here IS the point — the errand is a way to spend them, and their deaths, on something the guild needs paid down here.',
              lose: 'You grasp the whole shape of your own expendability, and it sits in your chest like the cold water.' }
          ]
        }
      },
      3: {
        place: 'The Outer Vault — swept',
        speaker: 'At the vault threshold',
        art: './art/ch5_fb3.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'You reach dry stone at last — the outer vault, its great door shut for a hundred years. Except the seal across the door is not a hundred years old. The wax is bright, sharp-edged, fresh. Newer than everything it guards.',
            choices: [
              { label: 'Examine the seal', next: 'seal' },
              { label: 'Read the door’s wear', next: 'door' }
            ]
          },
          seal: {
            text: 'Charter wax, cleanly stamped, laid within the year over a scar of old wax, over another, over another — a whole history of reseals stacked at the join. This door is opened and closed again on a schedule, and made to look untouched each time.',
            go: 'Opened for what?'
          },
          door: {
            text: 'The threshold stone is worn by a century of comings and goings the fresh seal is meant to deny. They open this vault, take what they take, seal it new, and let each company believe it is the first through in a hundred years.',
            go: 'We are not the first. We are the latest.'
          }
        },
        challenge: {
          name: 'The Fresh Seal', nid: 'ch5_fb3', type: 'room', reward: { kind: 'buffEffect', buffKey: 'inspired' },
          desc: 'A "century-sealed" vault whose wax was stamped within the year, over layers of older reseals. Read how routinely the Charter really opens this door.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'spellcast', backdrop: './art/ch5_fb3_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'perception', label: 'Count the layers of wax',
              win: 'Reseal on reseal on reseal, stacked at the door’s edge — a decade of openings at least, each one dressed up as the first. The forgotten vault is on a maintenance rota.',
              lose: 'The wax is a smeared mess. You can’t number the reseals.' },
            { tier: 'standard', skill: 'arcana', label: 'Test the seal’s making',
              win: 'The binding worked into the wax is guild-craft, recent and competent — not a relic ward but a fresh lock, re-set by someone who knew exactly what they were shutting back in each time.',
              lose: 'The ward resists your reading, sullen and cold.' },
            { tier: 'risky', skill: 'investigation', label: 'Find the reseal records', failEffect: 'curse',
              win: 'Scratched tallies beside the door, a clerk’s habit — dates of opening, going back and back, at steady intervals. The Charter has been drawing on this vault, quietly, for generations.',
              lose: 'You pry at the door’s secret and something set to guard the secret stirs against you.' }
          ]
        }
      },
      4: {
        place: 'The Filing Vault — swept',
        speaker: 'Among the shelves',
        art: './art/ch5_fb4.webp',
        start: 'root',
        nodes: {
          root: {
            text: 'The vault is not a treasury. It is an archive. Rank on rank of shelves hold hundreds of iron-bound cases exactly like the one you were sent to fetch — each tagged with a company’s name and a single date.',
            choices: [
              { label: 'Read the tags', next: 'tags' },
              { label: 'Find your own company’s shelf', next: 'ours' }
            ]
          },
          tags: {
            text: 'Company names you half-know, each beside a date. Some dates are long past — companies you could look up in the death-wall’s slate. But the shelves run on, and the dates run on, into months and years that have not happened yet.',
            go: 'Dates that haven’t happened yet.'
          },
          ours: {
            text: 'There is a gap on a near shelf, dusted and ready, tagged with a name you signed only days ago: your own company. Beside it, a date. It is not today’s. It is later. The case for it has not been filed. Not yet.',
            go: 'This isn’t a vault. It’s a schedule, and we’re on it.'
          }
        },
        challenge: {
          name: 'The Shelf With Your Name', nid: 'ch5_fb4', type: 'room', reward: { kind: 'shortcut' },
          desc: 'An archive of sealed cases tagged with companies and dates — many of the dates still in the future, one shelf waiting with your own company’s name. Read what the Charter is really keeping down here.',
          visuals: { props: ['./dcss/item/misc/misc_box.png'], heroAnim: 'walk', backdrop: './art/ch5_fb4_bg.webp' },
          approaches: [
            { tier: 'safe', skill: 'investigation', label: 'Work out the filing system',
              win: 'One case per company, one date per case: the day the Charter expects that company to be spent. The past shelves are full and closed. The future shelves are labelled and waiting. It is a ledger of scheduled deaths.',
              lose: 'The system is vast and lightless and you cannot hold its shape.' },
            { tier: 'standard', skill: 'history', label: 'Cross the dates against the dead',
              win: 'Every past date matches a name on Charterhall’s memorial to the day. The wall doesn’t mourn the fallen — it confirms the schedule kept. The future dates are simply appointments not yet come.',
              lose: 'You can’t hold enough of the record at once to prove the pattern.' },
            { tier: 'risky', skill: 'religion', label: 'Understand what the cases feed', failEffect: 'curse',
              win: 'Each case is a life’s worth of service, sealed and filed and rendered down to feed the thing the whole order exists to keep bound. Your company’s empty shelf is a promise the Charter has already made on your behalf.',
              lose: 'You reach for the purpose of the place and the purpose reaches back, and it knows your company’s name.' }
          ]
        }
      }
    },

    briefing: {
      speaker: 'Factor Emeric Sallow, Adventurers’ Charter',
      portrait: null,
      art: './art/ch5_briefing.webp',
      start: 'root',
      nodes: {
        root: {
          text: 'Simple work, well paid — the sort of contract a Chartered company gets and a free one doesn’t. There is a case in our vault under Marrowfen. Bring it to me. Do not open it. That last part is not a test and it is not superstition; it is a filing matter and it is above both of us.',
          choices: [
            { label: '“What’s in it?”', next: 'inside' },
            { label: '“Why is a Charter vault under a drowned fen?”', next: 'why' },
            { label: '“What’s guarding it?”', next: 'guard' },
            { label: '“Sealed case, unopened. We march.”', setOut: true }
          ]
        },
        inside: {
          text: 'Records. I am being honest with you, which I would like noted: it is a box of paper. It is worth nothing to anyone outside the Charter and a great deal to us, and if you open it you will not find treasure, you will find bookkeeping. I would simply rather you didn’t. Please.',
          choices: [
            { label: '“That’s a lot of fee for bookkeeping.”', next: 'why' },
            { label: '“Paper it is. We march.”', setOut: true }
          ]
        },
        why: {
          text: 'Because a fen doesn’t burn, doesn’t get raided, and doesn’t get built over. We have eleven of them. You put the records you cannot afford to lose where nobody will ever casually go, and then you pay people like me to make sure nobody goes casually. Take the vault key. Third turn, then left.',
          effect: { flag: 'scouted' },
          choices: [
            { label: '“And the ones you can afford to lose?”', next: 'root' },
            { label: '“Third turn, then left. We march.”', setOut: true }
          ]
        },
        guard: {
          text: 'A Warden. Ours — was ours. I’ll not dress it up for you: the Charter used to post volunteers to long vaults under an old arrangement we don’t use any more, and some of those postings never ended. If it comes at you, it isn’t malice. It’s a soldier at a door who was never told to stand down. Take the draught. And be quick about it, for its sake as much as yours.',
          effect: { potion: 'heal' },
          choices: [
            { label: '“An arrangement you don’t use any more.”', next: 'root' },
            { label: '“Then we’ll be quick. We march.”', setOut: true }
          ]
        }
      }
    }
  }
];

/* ---------------- Curated encounter overrides ----------------
   The bestiary's "Story Quests" tab edits a mission's cast — the per-floor mob
   pools, the fallback roster, and the final-boss block — without touching the
   authored prose above. Edits land in story_encounters.json (saved from the
   editor) and, while iterating, in localStorage. Overrides are keyed by
   mission id; any field left out keeps whatever the mission literal declares. */

const STORY_ENCOUNTER_EDITS_KEY = 'dc_story_encounter_edits';

/** File overrides merged with the editor's unsaved localStorage edits. */
export function getStoryEncounterOverrides() {
  let live = {};
  try { live = JSON.parse(globalThis.localStorage?.getItem(STORY_ENCOUNTER_EDITS_KEY) || '{}'); } catch { live = {}; }
  const base = STORY_ENCOUNTER_OVERRIDES || {};
  const out = {};
  for (const id of new Set([...Object.keys(base), ...Object.keys(live || {})])) {
    out[id] = { ...(base[id] || {}), ...((live && live[id]) || {}) };
  }
  return out;
}

/** Apply one mission's override in place. Idempotent. */
export function applyStoryEncounterOverride(mission, overrides = null) {
  if (!mission || !mission.id) return mission;
  const all = overrides || getStoryEncounterOverrides();
  const ov = all[mission.id];
  if (!ov) return mission;

  if (ov.finalBossId) mission.finalBossId = ov.finalBossId;
  if (ov.finalBossName != null) mission.finalBossName = ov.finalBossName;
  if (ov.bossHpMult != null) mission.bossHpMult = ov.bossHpMult;
  if (ov.monsterRoster) mission.monsterRoster = JSON.parse(JSON.stringify(ov.monsterRoster));

  if (ov.floors && Array.isArray(mission.floorPlan)) {
    for (const [idx, patch] of Object.entries(ov.floors)) {
      const floor = mission.floorPlan[Number(idx) - 1];
      if (!floor || !patch) continue;
      /* crBudget: how much this floor may spend buying creatures out of its
         whitelist (see planStoryFloorCast). null clears it back to derived. */
      if ('crBudget' in patch) {
        if (patch.crBudget == null) delete floor.crBudget;
        else floor.crBudget = patch.crBudget;
      }
      if (!patch.monsters) continue;
      /* An empty pool is the editor's "clear this floor" — drop the field
         entirely so the floor falls through to the mission roster rather than
         handing the spawner an empty (but present) cast. */
      if (Object.keys(patch.monsters).length) floor.monsters = JSON.parse(JSON.stringify(patch.monsters));
      else delete floor.monsters;
    }
  }

  /* game.js reads escorts off quest.bossEncounter (the same shape the curated
     boss table uses), and only honours them when its bossId matches the
     mission's finalBossId — so build the block from the resolved boss. */
  if (Array.isArray(ov.bossEscorts) && ov.bossEscorts.length) {
    mission.bossEncounter = {
      bossId: mission.finalBossId,
      bossTitle: mission.finalBossName,
      bossHpMult: mission.bossHpMult,
      escorts: JSON.parse(JSON.stringify(ov.bossEscorts))
    };
  } else if (ov.bossEscorts) {
    /* explicit empty list — author wants no escorts, not the fallback pair */
    mission.bossEncounter = { bossId: mission.finalBossId, bossTitle: mission.finalBossName, escorts: [] };
  }

  return mission;
}

/** The missions exactly as authored above, before any override is merged in.
 *  The bestiary's Story Quests tab diffs against this so "reset" can restore
 *  the authored cast even though STORY_MISSIONS itself is patched at load. */
export const STORY_MISSIONS_BASE = JSON.parse(JSON.stringify(STORY_MISSIONS));

/* Applied once at load so the world map, mission list and boss cards show the
   curated names; makeStoryQuest re-applies so edits made mid-session land
   without a reload. */
(() => {
  const all = getStoryEncounterOverrides();
  if (Object.keys(all).length) for (const m of STORY_MISSIONS) applyStoryEncounterOverride(m, all);
})();

/** Missions with lock/completion state resolved from game.storyProgress. */
export function storyMissionState(game) {
  const done = (game && game.storyProgress) || {};
  return STORY_MISSIONS.map((m, i) => ({
    mission: m,
    completed: !!done[m.id],
    unlocked: i === 0 || !!done[STORY_MISSIONS[i - 1].id]
  }));
}

/** Deep-copy a mission into a fresh quest object so run state (rewardClaimed,
 *  objective progress, …) never leaks back into the template. */
export function makeStoryQuest(mission) {
  return applyStoryEncounterOverride(JSON.parse(JSON.stringify(mission)));
}
