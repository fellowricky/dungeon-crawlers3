/* Batch A — scalar flags & regeneration:
 *   Magic Resistance, Pack Tactics, Blood Frenzy, Swarm half-HP, Martial
 *   Advantage, and the Regeneration `regen` field for the troll/vampire/
 *   oni/shield-guardian families.
 */
export default {
  /* Magic Resistance trait → magicResistance flag */
  juggernaut:           { flags: { magicResistance: true } },
  'profane-servitor':   { flags: { magicResistance: true } },
  daeva:                { flags: { magicResistance: true } },
  angel:                { flags: { magicResistance: true } },
  'hell-sentinel':      { flags: { magicResistance: true } },
  'ice-fiend':          { flags: { magicResistance: true } },
  fiend:                { flags: { magicResistance: true } },
  balrug:               { flags: { magicResistance: true } },
  'green-death':        { flags: { magicResistance: true } },
  'blue-death':         { flags: { magicResistance: true } },
  hellion:              { flags: { magicResistance: true } },
  tormentor:            { flags: { magicResistance: true } },
  'guardian-mummy':     { flags: { magicResistance: true } },
  'greater-mummy':      { flags: { magicResistance: true } },
  'mummy-lord':         { flags: { magicResistance: true } },
  'bone-devil':         { flags: { magicResistance: true } },
  'chain-devil':        { flags: { magicResistance: true } },
  erinyes:              { flags: { magicResistance: true } },
  marilith:             { flags: { magicResistance: true } },
  nalfeshnee:           { flags: { magicResistance: true } },
  'clay-golem':         { flags: { magicResistance: true } },
  'stone-golem':        { flags: { magicResistance: true } },
  unicorn:              { flags: { magicResistance: true } },
  solar:                { flags: { magicResistance: true } },
  planetar:             { flags: { magicResistance: true } },
  'night-hag':          { flags: { magicResistance: true } },

  /* Pack Tactics trait → packTactics flag */
  'grey-rat':           { flags: { packTactics: true } },
  'winter-wolf':        { flags: { packTactics: true } },
  'giant-vulture':      { flags: { packTactics: true } },

  /* Blood Frenzy (sharks / sahuagin) → bloodFrenzy flag */
  sahuagin:             { flags: { bloodFrenzy: true } },
  'giant-shark':        { flags: { bloodFrenzy: true } },
  'hunter-shark':       { flags: { bloodFrenzy: true } },

  /* Martial Advantage (hobgoblin line) → martialAdvantage flag */
  hobgoblin:            { flags: { martialAdvantage: true } },
  'hobgoblin-captain':  { flags: { martialAdvantage: true } },
  'hobgoblin-warlord':  { flags: { martialAdvantage: true } },

  /* Swarm half-HP damage reduction → swarm flag */
  'swarm-of-rats':      { flags: { swarm: true } },
  'swarm-of-bats':      { flags: { swarm: true } },
  'swarm-of-beetles':   { flags: { swarm: true } },
  'swarm-of-centipedes':{ flags: { swarm: true } },
  'swarm-of-insects':   { flags: { swarm: true } },
  'swarm-of-poisonous-snakes': { flags: { swarm: true } },
  'swarm-of-ravens':    { flags: { swarm: true } },
  'swarm-of-spiders':   { flags: { swarm: true } },
  'swarm-of-wasps':     { flags: { swarm: true } },
  'giant-leech':        { flags: { swarm: true } },
  'giant-cockroach':    { flags: { swarm: true } },

  /* Regeneration trait → regen field (troll family / vampire / oni / shield-guardian) */
  'deep-troll':            { flags: { regen: 10 } },
  'deep-troll-berserker':  { flags: { regen: 10 } },
  'deep-troll-earth-mage': { flags: { regen: 10 } },
  'deep-troll-shaman':     { flags: { regen: 10 } },
  'iron-troll':            { flags: { regen: 10 } },
  'rock-troll':            { flags: { regen: 10 } },
  'vampire-knight':        { flags: { regen: 20 } },
  'vampire-mage':          { flags: { regen: 20 } },
  oni:                     { flags: { regen: 10 } },
  'shield-guardian':       { flags: { regen: 10 } },
};
