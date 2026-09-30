// GameEngine methods: fish sizes, personal bests and records, and fishing spots (see ../fish.js).
// Every fish caught (chat !fish or the Fishing page) gets a length and weight and is saved, so the
// Fishing page can show it in 3D. Mixed into GameEngine.prototype by engine.js.
const { FISH, SPOTS, SPOT_BY_ID, rollSize, fmtLength, fmtWeight, sizeScore } = require('../fish');
const { ITEMS, SKILLS, fmt, skillLevel } = require('./shared');

// Most catches saved per action (a big haul at high level is still one line in the log).
const MAX_SAVED = 12;

module.exports = {
  // Sizes use their own random numbers so they never shift the game's other rolls.
  sizeRandom() {
    return (this.sizeRng || Math.random)();
  },

  // Saves `qty` catches of a fish and returns { catches, text } for the chat reply.
  recordCatch(user, fish, qty = 1, spot = null) {
    if (!FISH[fish]) return null;
    const now = this.now();
    const pbBefore = this.repo.catchBest(user.id, fish);
    const recBefore = this.repo.catchRecord(fish);
    const catches = [];
    for (let i = 0; i < Math.min(qty, MAX_SAVED); i++) {
      const size = rollSize(fish, () => this.sizeRandom());
      const id = this.repo.catchInsert(user.id, { fish, length: size.length, weight: size.weight, spot }, now);
      catches.push({ id, fish, ...size });
    }
    const best = catches.reduce((a, b) => (b.weight > a.weight ? b : a));
    const pb = !pbBefore || best.weight > pbBefore.weight;
    const record = !recBefore || best.weight > recBefore.weight;
    best.pb = pb && !!pbBefore;
    best.record = record && !!recBefore;
    best.first = !pbBefore;
    // Beating someone's record with a big fish is news (small records fall all the time early on,
    // and the very first catch of a fish isn't a record at all).
    if (best.record && sizeScore(fish, best.length) >= 0.9) {
      const was = recBefore.user_id === user.id ? 'their own' : `${recBefore.username}'s`;
      this.announce?.(`🏆 @${user.username} landed a record ${ITEMS[fish].icon} ${ITEMS[fish].name}: ${fmtLength(best.length)}, ${fmtWeight(best.weight)}, beating ${was} ${fmtWeight(recBefore.weight)}! ${this.siteUrl}/#/fishing`);
      this.emitActivity(user, { kind: 'rare', skill: 'fishing', item: fish, text: `landed a RECORD ${ITEMS[fish].name}: ${fmtLength(best.length)}, ${fmtWeight(best.weight)} 🏆` });
    }
    this.justCaught ??= new Map();
    this.justCaught.set(user.id, catches);
    const size = `${fmtLength(best.length)}, ${fmtWeight(best.weight)}`;
    const tag = best.record ? ' · 🏆 NEW RECORD' : best.pb ? ' · 🏅 personal best' : best.trophy ? ' · 🌟 trophy' : '';
    const what = catches.length > 1 ? `biggest ${size}` : size;
    return { catches, best, text: `📏 ${what}${tag}` };
  },

  // The catches from this player's last fishing action (for the website), then forgotten.
  takeJustCaught(userId) {
    const c = this.justCaught?.get(userId) || [];
    this.justCaught?.delete(userId);
    return c;
  },

  catchView(row) {
    if (!row || !FISH[row.fish]) return null;
    const it = ITEMS[row.fish];
    return {
      id: row.id,
      fish: row.fish,
      name: it.name,
      icon: it.icon,
      length: row.length,
      weight: row.weight,
      lengthText: fmtLength(row.length),
      weightText: fmtWeight(row.weight),
      score: Math.round(sizeScore(row.fish, row.length) * 100) / 100,
      spot: row.spot || null,
      username: row.username,
      at: row.created_at,
    };
  },

  fishingSpots(level = 0) {
    return SPOTS.map((s) => ({ ...s, locked: level < s.level }));
  },

  // !fish at a spot from the website: same as chat !fish, but only that water's fish.
  castAt(user, spotId) {
    const spot = SPOT_BY_ID[String(spotId)];
    if (!spot) return { error: 'no such fishing spot.' };
    const level = skillLevel('fishing', this.repo.getSkills(user.id).fishing);
    if (level < spot.level) return { error: `${spot.icon} ${spot.name} needs 🎣 Fishing level ${spot.level} (you are ${level}).` };
    this.takeJustCaught(user.id);
    const reply = this.runAction(user, 'fishing', [], { spot: spot.id });
    const xp = this.repo.getSkills(user.id).fishing;
    return { reply, level: skillLevel('fishing', xp), xp, catches: this.takeJustCaught(user.id).map((c) => ({ ...this.catchView({ ...c, created_at: this.now(), username: user.username, spot: spot.id }), trophy: c.trophy, pb: c.pb, record: c.record, first: c.first })) };
  },

  // Everything the Fishing page shows.
  fishingPage(userId = null) {
    const skills = userId ? this.repo.getSkills(userId) : null;
    const level = skills ? skillLevel('fishing', skills.fishing) : 0;
    const bests = userId ? Object.fromEntries(this.repo.catchBests(userId).map((r) => [r.fish, this.catchView(r)])) : {};
    const records = Object.fromEntries(this.repo.catchRecords().map((r) => [r.fish, this.catchView(r)]));
    const res = SKILLS.fishing.resources;
    const levelOf = (fish) => res.find((r) => r.item === fish)?.level ?? null;
    return {
      level,
      xp: skills ? skills.fishing : null,
      tool: userId ? this.currentTool(userId, 'fishing') : null,
      stamina: userId ? this.stamina(userId) : null,
      spots: this.fishingSpots(level),
      species: Object.entries(FISH).map(([id, [min, max, wMax, look]]) => ({
        id,
        name: ITEMS[id].name,
        icon: ITEMS[id].icon,
        level: levelOf(id),
        rare: levelOf(id) === null,
        min,
        max,
        maxWeight: wMax,
        look,
        spots: SPOTS.filter((s) => s.fish.includes(id)).map((s) => s.id),
        best: bests[id] || null,
        record: records[id] || null,
      })),
      recent: userId ? this.repo.catchesOf(userId, 40).map((r) => this.catchView(r)) : [],
      caught: userId ? this.repo.catchCount(userId) : 0,
      feed: this.repo.catchRecent(12).map((r) => this.catchView(r)),
    };
  },

  catchById(id) {
    return this.catchView(this.repo.catchGet(Number(id)));
  },
};
