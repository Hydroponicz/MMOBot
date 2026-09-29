// GameEngine methods: gathering stations (crab pots, ore drills, tree saplings, dig sites). The
// farming loop for the other gathering skills: stations work on their own, and !collect gathers
// what every ready station found for one stamina charge. Mixed into GameEngine.prototype by engine.js.
const { ITEMS, SKILLS } = require('../skills');
const { STATIONS, MAX_STATIONS, STARTER_STATIONS } = require('../stations');
const { fmt, itemLabel, skillLevel, minutesLeft } = require('./shared');

const BY_SKILL = Object.fromEntries(STATIONS.map((s) => [s.skill, s]));
const BY_ITEM = Object.fromEntries(STATIONS.map((s) => [s.item, s]));

module.exports = {
  isStationItem(item) {
    return !!BY_ITEM[item];
  },

  stationCount(userId, skill) {
    return Math.min(MAX_STATIONS, STARTER_STATIONS + (this.repo.getEquipment(userId)[`st_${skill}`] || 0));
  },

  // Same curve as farm plots: each station you buy costs plotPriceGrowth times the one before.
  stationPrice(userId, skill, ahead = 0) {
    const s = BY_SKILL[skill];
    const base = this.shopItems().find((x) => x.item === s.item)?.cost ?? s.cost;
    const bought = Math.max(0, this.stationCount(userId, skill) - STARTER_STATIONS) + ahead;
    const price = base * (this.cfg.plotPriceGrowth ?? 1.12) ** bought;
    return Math.min(1e15, price < 10000 ? Math.round(price / 10) * 10 : Math.round(price / 100) * 100);
  },

  stationsPrice(userId, skill, qty) {
    let total = 0;
    for (let i = 0; i < qty; i++) total += this.stationPrice(userId, skill, i);
    return total;
  },

  // How long a station takes, by your level in its skill (like crops: 20 min, +5 every 40 levels).
  stationMinutes(userId, skill) {
    const level = skillLevel(skill, this.repo.getSkills(userId)[skill]);
    return (20 + 5 * Math.floor(level / 40)) * (this.cfg.growMultiplier ?? 1);
  },

  stationRuns(userId) {
    return this.repo.getSetting(`stations:${userId}`) || {};
  },

  // One skill's stations: { count, readyAt, ready, owed } (owed = found but not yet collected, bag was full).
  stationState(userId, skill, now = this.now()) {
    const run = this.stationRuns(userId)[skill];
    const count = this.stationCount(userId, skill);
    // A station that has never run is ready straight away (a free first haul).
    const readyAt = run ? run.at + this.stationMinutes(userId, skill) * 60_000 : 0;
    const owed = run?.owed || 0;
    return { skill, count, readyAt, owed, ready: owed > 0 || now >= readyAt };
  },

  allStations(userId) {
    const now = this.now();
    return STATIONS.map((s) => ({ ...s, ...this.stationState(userId, s.skill, now), price: this.stationPrice(userId, s.skill) }));
  },

  buyStations(user, qty, found) {
    const s = BY_ITEM[found.item];
    const have = this.stationCount(user.id, s.skill);
    if (have >= MAX_STATIONS) return `you already have the maximum of ${MAX_STATIONS} ${s.name}s! 🏆`;
    qty = Math.min(qty, MAX_STATIONS - have);
    const total = this.stationsPrice(user.id, s.skill, qty);
    return this.repo.transaction(() => {
      const refused = this.pay(user, total, qty > 1 ? `${qty} ${s.name}s` : s.name);
      if (refused) return refused;
      this.repo.setEquipment(user.id, `st_${s.skill}`, have + qty - STARTER_STATIONS);
      this.emitActivity(user, { kind: 'buy', text: `bought ${qty > 1 ? `${qty} ${s.name}s` : `a ${s.name}`} (${have + qty} total)` });
      const next = have + qty < MAX_STATIONS ? ` Next one: ${fmt(this.stationPrice(user.id, s.skill))} pts.` : '';
      return `${s.icon} bought ${qty > 1 ? `${qty} ${s.name}s` : `a ${s.name}`} for ${fmt(total)} pts! You now have ${have + qty}. They start on the next cycle: ${this.cfg.prefix}collect when they're ready.${next}`;
    });
  },

  // !collect: everything every ready station gathered, for one stamina charge.
  collectStations(user) {
    const now = this.now();
    const states = STATIONS.map((s) => ({ s, st: this.stationState(user.id, s.skill, now) }));
    const ready = states.filter((x) => x.st.ready && x.st.count > 0);
    if (!ready.length) {
      const next = states.sort((a, b) => a.st.readyAt - b.st.readyAt)[0];
      return `your stations are still working. Next: ${next.s.icon} ${next.s.name}${next.st.count === 1 ? "" : "s"} in ${minutesLeft(next.st.readyAt - now)}. ${this.cfg.prefix}stations shows them all.`;
    }
    const bag = this.backpack(user.id);
    let room = bag.capacity - bag.used;
    if (room <= 0) return `🎒 your backpack is full (${bag.used}/${bag.capacity})! !sell or !upgrade backpack, then ${this.cfg.prefix}collect.`;
    const tired = this.staminaCheck(user, now);
    if (tired !== null) return tired || null;

    const runs = this.stationRuns(user.id);
    const parts = [];
    let leftover = 0;
    const results = [];
    this.repo.transaction(() => {
      for (const { s, st } of ready) {
        const skill = SKILLS[s.skill];
        const level = skillLevel(s.skill, this.repo.getSkills(user.id)[s.skill]);
        const unlocked = skill.resources.filter((r) => r.level <= level);
        const due = st.owed > 0 ? st.owed : st.count;
        const take = Math.min(due, room);
        const got = {};
        let xp = 0;
        for (let i = 0; i < take; i++) {
          const r = this.pickResource(unlocked);
          got[r.item] = (got[r.item] || 0) + 1;
          xp += r.xp;
        }
        for (const [item, q] of Object.entries(got)) this.repo.addItem(user.id, item, q);
        room -= take;
        const owed = due - take;
        leftover += owed;
        // Fully collected: the stations start their next cycle now. Otherwise the rest wait for room.
        runs[s.skill] = owed > 0 ? { at: runs[s.skill]?.at ?? now, owed } : { at: now, owed: 0 };
        if (take) results.push({ s, got, xp });
      }
      this.repo.setSetting(`stations:${user.id}`, runs);
      if (results.length) this.spendStamina(user, now);
    });
    for (const { s, got, xp } of results) {
      const list = Object.entries(got).map(([id, q]) => `${q}x ${ITEMS[id].name}`).join(', ');
      this.emitActivity(user, { kind: 'action', skill: s.skill, item: Object.keys(got)[0], xp, text: `${s.verb} ${list} from ${s.name.toLowerCase()}s` });
      const gained = this.grantXp(user, s.skill, this.xpFor(xp, this.currentTool(user.id, s.skill)));
      parts.push(`${s.icon} ${Object.entries(got).map(([id, q]) => itemLabel(id, q)).join(', ')} (${gained.text.split(' (')[0]})`);
    }
    if (!results.length) return `🎒 no backpack space to collect (${bag.used}/${bag.capacity}). !sell first.`;
    const note = leftover ? ` 🎒 Backpack full: ${leftover} more waiting, !sell and !collect again.` : ` Next haul in ${minutesLeft(Math.min(...STATIONS.map((s) => this.stationMinutes(user.id, s.skill))) * 60_000)}.`;
    return `📦 collected ${parts.join(' · ')}!${note}`;
  },

  // !stations
  stationsInfo(user) {
    const p = this.cfg.prefix;
    const now = this.now();
    const list = this.allStations(user.id).map((s) => `${s.icon} ${s.count} ${s.name}${s.count === 1 ? '' : 's'} ${s.ready ? '✅ ready' : `(${minutesLeft(s.readyAt - now)})`}`);
    return `🏡 Stations: ${list.join(' · ')}. ${p}collect gathers everything ready for 1 stamina. More: ${p}buy crab pot / ore drill / sapling / dig site.`;
  },
};
