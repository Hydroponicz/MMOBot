// GameEngine methods: the player-vs-player combat core. Every PvP fight (duels, the ranked arena,
// heists that turn into a fight, and whatever comes next) goes through pvpCombat(), so they all use
// the same rules. Mixed into GameEngine.prototype by engine.js.
//
// A combatant fights with the combat skill they're best at and their best weapon for it (like
// !fight), plus their armor, enchantments, set bonus, potions and race perks (fightStats), and
// their combat level:
//   - Accuracy: 75% to land a hit, +/-0.4% per combat level above/below the other fighter
//     (35% to 95%).
//   - Damage: (weapon skill level + attack) x 50-100%, less the defender's armor
//     (defence / (defence + 100) is blocked).
//   - HP: max HP by combat level, or (realHp) the fighter's current HP, e.g. a robber who's hurt.
// Bonuses ({ attack, defence } multipliers) cover things like hired guards.
//
// Fighting styles (the skill's `style`) work here too: the hit range, critical hits and double
// swings shape your damage, dodges and minions soak the other side's, a stun costs them their next
// swing, and a spear's reach means you swing first.
const { ITEMS, SKILLS } = require('./shared');

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

module.exports = {
  // A fighter's stats for PvP. opts: { realHp, bonus: { attack, defence } }.
  pvpCombatant(userId, { realHp = false, bonus = {} } = {}) {
    const u = this.repo.getUser(userId);
    const combatLevel = this.combatLevel(userId);
    const pick = this.chooseWeapon(userId);
    const armed = !!pick.weapon;
    const stats = armed ? this.fightStats(userId, pick) : { attack: 0, defence: this.combatStats(userId).defence };
    const vit = this.vitals(userId);
    const skillName = armed ? SKILLS[pick.skillId].name : 'Fists';
    const skillLevel = armed ? pick.level : combatLevel;
    return {
      id: userId,
      username: u.username,
      combatLevel,
      skillId: armed ? pick.skillId : null,
      skillLevel,
      weapon: pick.weapon || null,
      attack: Math.round(stats.attack * (bonus.attack ?? 1)),
      defence: Math.round(stats.defence * (bonus.defence ?? 1)),
      style: stats.style || null,
      maxHp: vit.maxHp,
      hp: realHp ? vit.hp : vit.maxHp,
      label: `${skillName} ${skillLevel}${armed ? `, ${ITEMS[pick.weapon].name}` : ''}`,
    };
  },

  pvpAccuracy(att, def) {
    return clamp(0.75 + (att.combatLevel - def.combatLevel) * 0.004, 0.35, 0.95);
  },

  pvpHit(att, def) {
    if (this.rng() < 1 - this.pvpAccuracy(att, def)) return 0; // a miss
    const a = att.style || {};
    const d = def.style || {};
    if (d.dodge && this.rng() < d.dodge) return 0;
    const lo = a.lo ?? 0.5;
    const hi = a.hi ?? 1;
    const offence = att.skillLevel + att.attack;
    let raw = offence * (lo + (hi - lo) * this.rng());
    if (a.crit && this.rng() < a.crit) raw *= a.critMul ?? 2;
    if (a.cleave && this.rng() < a.cleave) raw *= 1.6;
    if (a.minionHit) raw += offence * a.minionHit;
    return Math.max(1, Math.round(raw * (1 - def.defence / (def.defence + 100)) * (1 - (d.soak || 0))));
  },

  // Fights two combatants (from pvpCombatant) until one drops or maxRounds pass. Doesn't change
  // anyone's HP: callers decide what a result means. Returns { winner, loser, rounds, a, b, dealt }
  // (winner null = nobody fell). firstStrike 'a' / 'b' / null (coin flip).
  pvpCombat(a, b, { maxRounds = 200, firstStrike = null } = {}) {
    const hp = { [a.id]: a.hp, [b.id]: b.hp };
    const dealt = { [a.id]: 0, [b.id]: 0 };
    // A spear's reach wins the coin flip (unless both have one).
    const reach = (f) => !!f.style?.reach;
    if (!firstStrike && reach(a) !== reach(b)) firstStrike = reach(a) ? 'a' : 'b';
    let [x, y] = firstStrike === 'a' ? [a, b] : firstStrike === 'b' ? [b, a] : this.rng() < 0.5 ? [a, b] : [b, a];
    let rounds = 0;
    while (hp[a.id] > 0 && hp[b.id] > 0 && rounds < maxRounds) {
      const dmg = Math.min(hp[y.id], this.pvpHit(x, y));
      hp[y.id] -= dmg;
      dealt[x.id] += dmg;
      rounds++;
      // A landed haymaker can stun: the other side loses their next swing.
      if (dmg > 0 && hp[y.id] > 0 && x.style?.stun && this.rng() < x.style.stun) continue;
      [x, y] = [y, x];
    }
    const left = { a: { ...a, hp: hp[a.id] }, b: { ...b, hp: hp[b.id] } };
    if (hp[a.id] > 0 && hp[b.id] > 0) return { winner: null, loser: null, rounds, ...left, dealt };
    const [winner, loser] = hp[a.id] > 0 ? [left.a, left.b] : [left.b, left.a];
    return { winner, loser, rounds, ...left, dealt };
  },

  // How a fight would likely go, without rolling dice (for "your odds" displays): compares how many
  // swings each side needs to drop the other. 'favoured' / 'even' / 'risky' / 'hopeless'.
  pvpOutlook(a, b) {
    const perSwing = (att, def) => {
      const sa = this.styleFactors(att.style);
      const sd = def.style || {};
      // A stun is like getting an extra swing in now and then.
      return this.pvpAccuracy(att, def) * (att.skillLevel + att.attack) * sa.hitMul * (1 - def.defence / (def.defence + 100)) * (1 - (sd.dodge || 0)) * (1 - (sd.soak || 0)) * (1 + (att.style?.stun || 0));
    };
    const aNeeds = b.hp / Math.max(0.01, perSwing(a, b));
    const bNeeds = a.hp / Math.max(0.01, perSwing(b, a));
    const ratio = bNeeds / aNeeds;
    return ratio >= 1.5 ? 'favoured' : ratio >= 0.8 ? 'even' : ratio >= 0.4 ? 'risky' : 'hopeless';
  },

  // Duels and the arena: both players on full HP, nobody gets hurt. Kept as pvpFight for callers.
  pvpFight(aId, bId) {
    return this.pvpCombat(this.pvpCombatant(aId), this.pvpCombatant(bId), { maxRounds: 500 });
  },
};
