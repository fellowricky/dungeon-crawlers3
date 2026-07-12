/**
 * Quest narrative text tables — pure data, zero imports.
 *
 * Everything the quest system says to the player lives here: embark and
 * victory narration, per-floor atmosphere, phase announcements and
 * aftermaths, ally personas, chain arc titles and epilogues.
 *
 * Template slots: {place} {locType} {boss} {ally} {part}
 * Every theme table falls back to `generic` when a theme key is missing.
 */

/* ---------------- quest opening narration (2-3 sentences, logged at embark
   and shown as the quest description on the world map) ---------------- */
export const QUEST_EMBARK = {
  ancient: [
    "The road to {place} is older than any map. Scholars paid good coin for what lies sealed beneath the {locType} — none of them came back to collect. The party goes where the scholars would not.",
    "Beneath the {locType} of {place}, something has begun to stir after a thousand years of silence. The village elders speak of lights in the ruins and voices in a dead tongue. Someone must go down and make it quiet again.",
    "A precursor seal beneath {place} has cracked, and what leaks out is not dust. The {locType} must be cleansed chamber by chamber. The party sharpens its blades and starts walking."
  ],
  verdant: [
    "The forest around {place} has stopped being a forest. Vines pull travelers from the road, and the {locType} at its heart breathes like a living thing. The party pushes into the green.",
    "Druids once tended the {locType} of {place}. Now the grove tends itself — and it is hungry. The party is paid to remind the wilds who planted them.",
    "A sickly-sweet miasma drifts from the overgrowth of {place}. Whatever roots at the heart of the {locType} must be cut out before the rot spreads to the farmlands."
  ],
  frost: [
    "The cold around {place} is wrong — it has intent. Shepherds found their flocks frozen mid-stride, facing the {locType}. The party wraps up warm and goes to ask the ice what it wants.",
    "An eternal-winter cult works its ritual deep in the {locType} of {place}, and every night the frost creeps a field closer to town. The party has until the ritual completes. Probably less.",
    "Something old sleeps under the ice of {place}, and lately its dreams have been leaking. The {locType} must be swept clean before it wakes fully."
  ],
  grim: [
    "The dead of {place} no longer rest. They climb from the {locType} at dusk and stand in the fields, watching the town with patient, empty eyes. The party is sent to give them something else to look at.",
    "A shadow curse hangs over the {locType} of {place} like a held breath. Priests blessed the walls; the walls wept. Now it is the party's problem.",
    "Souls are being harvested beneath {place} — the {locType} runs on them like a mill runs on water. Break the mill. Free the water."
  ],
  molten: [
    "The ground under {place} has been growling for a month, and last week the wells started steaming. Deep in the {locType}, something feeds the fire. The party descends into the heat.",
    "Fire has claimed the {locType} beneath {place} — not wild flame, but worked flame, forged and commanded. Whoever holds the forge holds the valley. The party means to take it back.",
    "A rift leaks primordial fire under {place}, and every day it leaks a little wider. Seal the {locType}, or the map-makers will need new ink."
  ],
  generic: [
    "Trouble stirs beneath {place}. The {locType} has claimed enough travelers that the reward finally outweighs the fear. The party takes the job.",
    "The {locType} of {place} has been silent too long — and now it is not silent at all. The party goes to see why."
  ]
};

/* ---------------- per-floor atmosphere line (early / mid / late by quest
   progress; lateIntel used on late floors once the boss is known) -------- */
export const FLOOR_FLAVOR = {
  ancient: {
    early: [
      "Dust lies undisturbed here — until the party disturbs it.",
      "Carvings on the walls show figures kneeling before something the sculptor refused to finish.",
      "The air tastes of old paper and older secrets."
    ],
    mid: [
      "The carvings grow newer here, and the kneeling figures fewer.",
      "Somewhere below, stone grinds against stone in a slow, patient rhythm.",
      "The torch flames bend toward the deep stair, as if something down there is breathing in."
    ],
    late: [
      "The walls here are warm. Stone should not be warm.",
      "The dead tongue on the walls has become legible. The party wishes it hadn't.",
      "Every carving on this level shows the same thing: a door, and something opening it from the wrong side."
    ],
    lateIntel: [
      "Fresh marks gouge the walls — the {boss} paces its lair somewhere close.",
      "The party moves quietly now. The {boss} is near, and it knows these halls better than they do."
    ]
  },
  verdant: {
    early: [
      "Roots thread the ceiling like veins. The dungeon is something's body.",
      "Flowers bloom in the torchlight, turn to follow the party, and are politely ignored.",
      "The green here is bright and welcoming, the way a lure is welcoming."
    ],
    mid: [
      "The vines have begun to grow in patterns. Patterns mean intent.",
      "Sap runs down the walls in slow rivulets. It is warm, and it smells faintly of copper.",
      "Birdsong echoes from below. There are no birds down here."
    ],
    late: [
      "The overgrowth parts ahead of the party now, inviting them deeper. Invitations like this are rarely kind.",
      "The whole floor pulses gently underfoot — a heartbeat, vast and slow.",
      "Every leaf on this level is turned toward the same distant chamber."
    ],
    lateIntel: [
      "Trees bend away from a clearing ahead. The {boss} has made its den at the heart of the green.",
      "Claw-stripped bark, crushed brambles — the {boss} passed this way, and recently."
    ]
  },
  frost: {
    early: [
      "Breath fogs and hangs in the still air like small ghosts.",
      "The ice underfoot is clear as glass. It is better not to look at what's frozen in it.",
      "Icicles chime softly overhead — almost a melody, almost a warning."
    ],
    mid: [
      "The frost here grows in spirals, and spirals are not what water does on its own.",
      "The cold has stopped biting and started pressing, like a hand on the back of the neck.",
      "Frozen figures line the passage. Their faces suggest they were running."
    ],
    late: [
      "The ice sings under every footstep — a high, thin note that carries much too far.",
      "It is cold enough now that the torches burn blue at the edges.",
      "The walls here are mirror-smooth ice, and the reflections lag half a step behind."
    ],
    lateIntel: [
      "The frost thickens toward a single chamber, radiating outward like a wound. The {boss} waits at its center.",
      "A bone-deep rumble rolls through the ice. The {boss} knows the party is coming."
    ]
  },
  grim: {
    early: [
      "The shadows here are a shade too dark, and a heartbeat too slow to follow the light.",
      "Chains hang from the ceiling, swaying gently. There is no wind.",
      "Someone scratched tally marks into the wall. They stop mid-stroke."
    ],
    mid: [
      "Whispers keep pace with the party — always one corridor over, always just below hearing.",
      "The candles in the wall-sconces are lit. Someone, or something, maintains them.",
      "The air is thick with the smell of grave-earth and snuffed candles."
    ],
    late: [
      "The darkness ahead has texture now, like cloth, like something that could be pulled aside.",
      "The whispers have stopped. The silence is worse.",
      "Down here, the party's own shadows kneel when they pass certain doors."
    ],
    lateIntel: [
      "The candles gutter and die toward one distant hall — the {boss} does not care for light.",
      "The whispers have found a single voice, and it repeats one thing: the {boss} is waiting."
    ]
  },
  molten: {
    early: [
      "Heat shimmers over the flagstones. The party's boots are already complaining.",
      "Veins of dull orange pulse through the walls, brightening and dimming like slow breath.",
      "Ash drifts down from somewhere above, soft as snow and twice as ominous."
    ],
    mid: [
      "The forge-sound grows louder below: hammer, hiss, hammer, hiss. Nothing living needs to breathe like that.",
      "Pools of magma light the path from below, painting every face in war-colors.",
      "The stone here is scarred by claws that were on fire at the time."
    ],
    late: [
      "It is hot enough now that the party moves between shadows like swimmers between islands.",
      "The mountain's pulse hammers underfoot, faster than it was. Something knows they're close.",
      "Metal fittings on the doors have half-melted and re-set, like wax — recently."
    ],
    lateIntel: [
      "The heat rolls out from one great chamber ahead. The {boss} stokes its own fire, waiting.",
      "Slag heaps and split anvils mark the {boss}'s temper. The party is close now."
    ]
  },
  generic: {
    early: ["The dungeon swallows the last of the daylight behind them."],
    mid: ["The way down grows narrower, and the dark more attentive."],
    late: ["Whatever rules this place, the party is walking into its throat now."],
    lateIntel: ["Sign of the {boss} is everywhere now. The lair is close."]
  }
};

/* ---------------- quest completion narration ---------------- */
export const QUEST_VICTORY = {
  ancient: [
    "The silence that settles over {place} is the honest kind — the silence of a tomb that is finally just a tomb. The party climbs back toward daylight, pockets heavy, boots full of the dust of a dead age.",
    "Whatever woke beneath {place} sleeps again, and this time nothing will sing it awake. The scholars can have their ruins back. The party takes the treasure as a handling fee."
  ],
  verdant: [
    "The green of {place} softens as the party walks out — the vines slack, the flowers just flowers again. Behind them the forest breathes out, long and slow, and lets them go.",
    "The rot at the heart of {place} is cut out, and already the honest wild is creeping back in over the scar. The party leaves greener than they came, in every sense."
  ],
  frost: [
    "The cold of {place} loses its intent and becomes mere winter. Somewhere behind the party, ice groans and settles into ordinary sleep. They walk out toward woodsmoke and warm bread.",
    "The frost releases {place} like a hand unclenching. By the time the party reaches the surface, water is dripping from the eaves of the world — the first thaw in a long, long time."
  ],
  grim: [
    "The dead of {place} lie down at last, and the shadows go back to being shadows. The party walks out under a sky that seems, for tonight at least, honestly dark instead of watchfully so.",
    "The curse over {place} snaps like an old rope, and the whole valley seems to stand up straighter. The party has earned every coin — and the nightmares they'll be having anyway."
  ],
  molten: [
    "The fires beneath {place} bank down to embers, and the mountain's growl fades to a grumble, then to nothing. The wells will run clean by spring. The party walks out into blessedly cool air.",
    "The forge under {place} stands cold and masterless. Let the earth keep its fire to itself for a century or two. The party carries out what spoils weren't nailed down or on fire."
  ],
  generic: [
    "It is done. {place} is quiet, the job is finished, and the party walks out of the dark into the pale, welcome light of the ordinary world."
  ]
};

/* ---------------- boss kill lines ---------------- */
export const BOSS_SLAIN = {
  ancient: [
    "The {boss} crashes down among its relics, and a thousand years of stolen silence come rushing back into {place} all at once.",
    "The {boss} falls, and the carvings on the walls seem to exhale. The old kingdom's last jailer is dead, and its last prisoner with it."
  ],
  verdant: [
    "The {boss} falls, and the whole green weight of {place} shudders — then stills. The forest has a new piece of legend to grow over.",
    "The {boss} collapses into the loam it terrorized. By summer there will be flowers on the spot, and they will be ordinary flowers."
  ],
  frost: [
    "The {boss} shatters the ice as it falls, and lies still in the wreckage of its own frozen kingdom. Somewhere far above, the wind changes.",
    "The {boss} goes down in a storm of frost and fury, and the terrible cold of {place} dies with it, degree by degree."
  ],
  grim: [
    "The {boss} falls, and every shadow in {place} snaps back to where it belongs. The dark is just the dark again.",
    "The {boss} crumbles, and the party hears — or imagines — a long sigh of release from every grave in {place}."
  ],
  molten: [
    "The {boss} falls in a spray of embers, and the great fire beneath {place} loses its will along with its master.",
    "The {boss} crashes into its own forge, and the flames, freed at last, begin to gutter out."
  ],
  generic: [
    "The {boss} falls, and silence takes {place} for the first time in an age."
  ]
};

/* Shorter lines for the bosses of non-final floors. */
export const MIDBOSS_SLAIN = [
  "The {boss} falls — but the true evil lies deeper still. Downward.",
  "The {boss} guards this floor no longer. The stair to the deep stands open.",
  "The {boss} is dead, and its hoard is lighter for it. The party presses on.",
  "With the {boss} down, this level belongs to the party. What waits below will not fall so easily."
];

/* ---------------- phase system text ---------------- */

/* Vague world-map rumors — shown on the quest detail pane, no floor numbers. */
export const PHASE_RUMORS = {
  ambush: [
    "Survivors speak of watchers in the dark — veterans, organized, waiting.",
    "A caravan guard swears the monsters there drilled like soldiers."
  ],
  puzzle: [
    "An old ward is said to seal the deepest hall — three trials, and no way around.",
    "Scholars mention a binding seal below. Brute force alone won't serve."
  ],
  ally: [
    "Word is another adventurer went in alone. They may yet live.",
    "A stranger was seen entering some days ago — and has not come out."
  ],
  gauntlet: [
    "They say the horde down there gives no quarter and no rest.",
    "Whatever nests there, it hunts anything that stops moving."
  ],
  foreshadow: [
    "Whispers name the thing at the bottom. Knowing it may be half the battle.",
    "Someone carved warnings about the master of that place. They may still be legible."
  ]
};

/* Floor-entry announcements (logged when the phase floor loads). */
export const PHASE_ANNOUNCE = {
  ambush: [
    "Eyes glitter in every doorway. This floor knew the party was coming — and mustered.",
    "The trap closes behind them: this floor's garrison is awake, armed, and everywhere."
  ],
  ambushDeclined: [
    "The party slips past the mustered watchers by the back ways. Quieter — and poorer.",
    "Sentries wait at the main halls; the party takes the servants' passages instead."
  ],
  puzzle: [
    "A great seal bars the inner sanctum, humming with old power. Three wards guard it — the wards must be tested.",
    "The way to this floor's heart is closed by a warded seal. No blade will open it; wit and nerve must."
  ],
  gauntlet: [
    "The sounds of pursuit echo from above. There will be no rest at the end of this floor — only the way down.",
    "The horde presses close behind. Camp is off the table; the party must clear through and keep moving."
  ],
  gauntletDeclined: [
    "The party takes the slow, safe road down, and the pursuit loses their scent.",
    "Discretion wins: the party circles wide of the horde and keeps their camp."
  ],
  foreshadow: [
    "This floor is quieter — a place for listening. And what the party hears is worth blood.",
    "Signs and leavings everywhere on this level speak of the thing that rules the deep."
  ]
};

/* Aftermath lines when a phase floor is cleared / resolved. */
export const PHASE_RESOLVED = {
  ambush: [
    "The ambushers lie broken, and their war-chest is the party's now. Let the deep places take note.",
    "The trap is sprung, the trappers are dead, and the spoils are excellent."
  ],
  puzzle: [
    "Behind the shattered seal, the air moves freely for the first time in an age.",
    "The wards are ash. Whatever they were protecting belongs to the party now."
  ],
  gauntlet: [
    "The party marches through the night, boots loud on the stone, and the pursuit falls away behind them.",
    "No rest, no camp — just the descent, and the grim satisfaction of outpacing the horde."
  ]
};

/* Pre-floor choice overlay copy. */
export const PHASE_CHOICES = {
  ambush: {
    title: 'AMBUSH AHEAD',
    desc: "The scouts are certain: the next floor is mustered and waiting — veterans, organized, lethal. Their war-chest travels with them. Spring the trap, or slip around it?",
    accept: { label: '⚔ Spring their trap', sub: 'Every foe an elite · double spoils · a war-chest bonus' },
    decline: { label: '🌫 Slip past the sentries', sub: 'A normal floor · no bonus' }
  },
  gauntlet: {
    title: 'THE HORDE PRESSES',
    desc: "Something vast moves through the halls above. Stop to trade and camp after this floor, and it catches up. Press on without pause, and the spoils of the deep run richer for the daring.",
    accept: { label: '🔥 Press on through the night', sub: 'No merchant after this floor · spoils cache on the next clear' },
    decline: { label: '⛺ Withdraw and regroup', sub: 'Normal pace · merchant camp as usual' }
  },
  ally: {
    title: 'A STRANGER IN THE DARK',
    desc: "Ahead, someone has survived down here alone — and offers their blade for the length of this floor. Two figures step from the shadows. Who walks with the party?"
  }
};

/* ---------------- temporary allies ---------------- */
export const ALLY_PERSONAS = {
  cleric: [
    {
      name: 'Sister Maren', race: 'human', gender: 'female',
      blurb: 'A wandering cleric with a mace and no patience for the unquiet dead.',
      join: "Sister Maren falls in beside the party, mace on her shoulder. \"Walk. I'll keep you standing.\"",
      bark: "\"On your feet,\" Sister Maren mutters, light spilling from her hands. \"I didn't come down here to bury anyone.\"",
      farewell: "At the stair, Sister Maren bows and turns back toward the surface. \"The light keep you. You'll need it down there.\""
    },
    {
      name: 'Brother Odric', race: 'dwarf', gender: 'male',
      blurb: 'A dwarven mendicant who heals with one hand and swings a mace with the other.',
      join: "Brother Odric stumps out of the dark, beard singed. \"Company at last. Try not to die faster than I can pray.\"",
      bark: "Brother Odric slams his mace down and barks a prayer that rattles the dust from the ceiling.",
      farewell: "Brother Odric claps each hero on the arm — low on the arm — and takes his leave. \"Go with stone and light.\""
    }
  ],
  merc: [
    {
      name: 'Vash the Unpaid', race: 'halforc', gender: 'male',
      blurb: 'A mercenary whose last employer is somewhere down here, and owes him money.',
      join: "\"My employer's dead somewhere below and owed me a month's wage,\" Vash says, hefting his blade. \"I'll take it out of the dungeon.\"",
      bark: "Vash carves through with grim bookkeeping. \"That one's for the back pay.\"",
      farewell: "Vash salutes with a bloody blade at the stair. \"Debt's settled. Good hunting.\" He vanishes back up the dark."
    },
    {
      name: 'Karra Redhand', race: 'human', gender: 'female',
      blurb: 'A sellsword with a red gauntlet and a reputation both earned.',
      join: "Karra Redhand pushes off the wall she was holding up. \"One floor, no charge. I like your odds.\"",
      bark: "Karra's red gauntlet flashes and something monstrous stops being a problem.",
      farewell: "\"That squares it,\" Karra says at the stair, already walking away. \"Try not to need me twice.\""
    }
  ],
  scout: [
    {
      name: 'Vex', race: 'halfling', gender: 'female',
      blurb: 'A dungeon-scout who has already been everywhere on this floor once.',
      join: "Vex drops soundlessly from a ledge. \"Took me two days to map this level. Took you an hour to make it loud. Come on — I know every corridor.\"",
      bark: "Vex's dagger finds the seam in something's armor. \"Told you. I know this floor.\"",
      farewell: "Vex sketches the party a map of nothing in the air, grins, and is gone between one torch and the next."
    },
    {
      name: 'Quiet Tam', race: 'human', gender: 'male',
      blurb: 'A poacher-turned-scout who speaks in nods and knows where everything is.',
      join: "Quiet Tam says nothing at all, but he points — and where he points, the map unrolls in the party's minds.",
      bark: "Quiet Tam is suddenly behind the enemy. Nobody saw him move. He nods, apologetically.",
      farewell: "At the stair, Quiet Tam nods once — which from him is a eulogy, a toast, and a farewell all together."
    }
  ]
};

/* ---------------- boss intel (foreshadow floors) ---------------- */
export const BOSS_INTEL_LINES = [
  "Scratched into the wall in a dead hand: the name of the thing below — the {boss}. Beneath it, one word: 'breathe'. The party commits every stroke to memory.",
  "A dying scholar's journal, brittle with age, names the master of the deep: the {boss}. Its habits, its temper, the hitch in its guard — all recorded. All remembered.",
  "The bones here are arranged as a warning, and the warning has a name: the {boss}. But a warning read carefully is a weapon."
];

export const BOSS_INTEL_COMBAT = [
  "The party knows this foe — they strike where the old warnings said to strike.",
  "Every scratched warning and stolen page pays off: the party reads the {boss} like a map."
];

/* ---------------- puzzle floor (2-of-3 ward challenge) ---------------- */
export const PUZZLE_WARDS = {
  ancient: ['The Ward of Dust', 'The Ward of Names', 'The Ward of the Threshold'],
  verdant: ['The Ward of Thorns', 'The Ward of Sap and Season', 'The Ward of the Rootgate'],
  frost: ['The Ward of Rime', 'The Ward of the Long Sleep', 'The Ward of the Frozen Door'],
  grim: ['The Ward of Silence', 'The Ward of the Watching Dead', 'The Ward of the Last Candle'],
  molten: ['The Ward of Cinders', 'The Ward of the Forgemaster', 'The Ward of the Brass Door'],
  generic: ['The First Ward', 'The Second Ward', 'The Final Ward']
};

export const PUZZLE_TEXT = {
  intro: "An ancient seal bars the way to this floor's heart. Three wards guard it — break two, and the seal falls.",
  roundDesc: [
    "The first ward hums at the party's approach, testing them.",
    "The second ward wakes, older and angrier than the first.",
    "The last ward burns with everything the seal has left."
  ],
  solved: "The seal shatters — the way to the inner sanctum stands open.",
  solvedFlawless: "All three wards break clean, and the seal doesn't just open — it surrenders. Something glitters in the wreckage.",
  cycleFail: "The wards flare and strike back! The seal holds — and something below has heard the noise.",
  forceOpen: "Battered and bloodied, the party simply refuses to stop. The seal, worn down by sheer stubbornness, gives way."
};

/* ---------------- side objectives ---------------- */
export const OBJECTIVE_COMPLETE = {
  slay: [
    "The last of them falls, and the tally is paid in full. The bounty is the party's.",
    "That's the lot of them. Somewhere, a grateful village sleeps easier."
  ],
  gems: [
    "The final gem clicks into the pouch — a collector will pay handsomely for the set.",
    "The last gem gleams in the torchlight. The set is complete, and worth a small fortune."
  ],
  chests: [
    "Every cache marked on the old map, found and emptied. The mapmaker's cut is still a bargain.",
    "The last strongbox creaks open. The salvage contract is fulfilled."
  ]
};

/* ---------------- quest chains (3-part sagas) ---------------- */
export const CHAIN_SUBTITLES = {
  2: ['Part II: The Descent', 'Part II: What Stirred Below', 'Part II: The Deeper Dark'],
  3: ['Part III: The Reckoning', 'Part III: The Last Door', 'Part III: The Heart of It']
};

/* After completing part I / II — the tease that a sequel exists. */
export const CHAIN_TEASE = {
  2: [
    "…but as the dust settles, a draft rises from below the lowest floor. There are deeper doors in {place}. Word will reach the party when the way is open.",
    "…yet the victory rings hollow at the edges. Something beneath {place} was only wounded, not ended. It will surface again — and so will the party."
  ],
  3: [
    "…but the thing that fell was a servant. Its master stirs at the very root of {place}, and now it knows the party's name. One last descent remains.",
    "…and in the silence after the battle, from far below, comes the sound of something enormous turning over in its sleep. The end of this story waits at the bottom of {place}."
  ]
};

/* Embark paragraphs for sequel quests, by part. */
export const CHAIN_EMBARK = {
  2: [
    "The party returns to {place}. The upper halls are quiet now — their quiet — but the stair goes deeper than it did, and the dark below has had time to prepare.",
    "Back to {place}, where the wound they left has scabbed over something worse. What stirred beneath the old battleground is done stirring. The party goes down to meet it."
  ],
  3: [
    "The last descent into {place}. Everything before was prelude — the servants, the seals, the warnings. At the very root of this place waits the author of all of it, and it is expecting them.",
    "{place}, one final time. The party knows every scar on these walls now, and the thing at the bottom knows every scar on them. Only one side is walking back out."
  ]
};

/* Epilogue paragraphs when part III completes. */
export const CHAIN_EPILOGUE = [
  "It is over — truly over. The evil beneath {place} is ended at its root, and the halls above will crumble into honest, harmless ruin. In the taverns they are already getting the story wrong, and the party lets them. They know what they did. SAGA COMPLETE.",
  "The deep root of {place} is cut, and the whole poisoned tree above it dies quiet. Three descents, three victories, and now — finally — a road home in daylight. Songs will be sung. Most of them will even be true.",
  "Whatever began beneath {place} long ago ends today, by the party's hand. The land itself seems to know it: birdsong returns to the valley before they've even cleaned their blades. The saga of {place} is finished — and it is theirs."
];

/* ---------------- misc runtime lines ---------------- */
export const GAUNTLET_DESCEND = [
  "No camp tonight — the horde presses close behind. The party descends at once, spoils rattling.",
  "Rest is for the pursued-by-nothing. The party takes the stair down at a run."
];

export const GAUNTLET_SPOILS = [
  "The night-march pays off: the spoils carried through the dark are richer for it.",
  "Daring has its dividend — the gauntlet's cache is the party's."
];

export const AMBUSH_WARCHEST = [
  "The ambushers' war-chest is pried open — the party's now, every coin.",
  "Spoils of a sprung trap: the mustered garrison's own war-chest."
];
