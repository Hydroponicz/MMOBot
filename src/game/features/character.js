// GameEngine methods: races, perks and character looks. Mixed into GameEngine.prototype by engine.js.
const { RACES, RACE_IDS, randomCharacter, cleanLook, publicOptions, publicRaces } = require('../appearance');

const DAY = 86_400_000;
const NO_PERKS = { xp: {}, hp: 1, mana: 1, attack: 1, defence: 1, sell: 1, luck: 1, food: 1, stamina: 0 };

module.exports = {
  // { race, look, custom }: what the player picked, or the random character they started with.
  appearance(userId) {
    const u = this.repo.getUser(userId);
    if (!u) return null;
    const random = randomCharacter(u.kick_user_id || u.id);
    let look = random.look;
    if (u.look) {
      try {
        look = { ...random.look, ...JSON.parse(u.look) };
      } catch {
        // A broken saved look falls back to the random one.
      }
    }
    const race = RACES[u.race] ? u.race : random.race;
    return { race, look, custom: !!u.race, raceChangedAt: u.race_changed_at || 0 };
  },

  // The player's race perks, filled in with "no change" (all 1s) for anything the race doesn't touch.
  // Admins can switch perks off (racePerks), which makes races cosmetic only.
  perks(userId) {
    if (this.cfg.racePerks === false) return NO_PERKS;
    const a = this.appearance(userId);
    return a ? { ...NO_PERKS, ...RACES[a.race].perks } : NO_PERKS;
  },

  // XP multiplier from the race for one skill.
  raceXp(userId, skillId) {
    const xp = this.perks(userId).xp || {};
    return (xp.all ?? 1) * (xp[skillId] ?? 1);
  },

  // When the player may pick a new race (0 = now).
  raceChangeAt(userId) {
    const a = this.appearance(userId);
    if (!a || !a.raceChangedAt) return 0;
    const at = a.raceChangedAt + (this.cfg.raceChangeDays ?? 30) * DAY;
    return at > this.now() ? at : 0;
  },

  // Saves a new look and/or race from the website. Returns { ok, message } or { ok: false, error }.
  setAppearance(user, { race, look } = {}) {
    const current = this.appearance(user.id);
    if (!current) return { ok: false, error: 'player not found' };
    const cleaned = cleanLook(look ?? {}, current.look);
    if (cleaned.error) return { ok: false, error: cleaned.error };
    let newRace = current.race;
    let changedAt = current.raceChangedAt;
    if (race !== undefined && race !== null && race !== current.race) {
      if (!RACE_IDS.includes(race)) return { ok: false, error: `unknown race: ${race}` };
      const wait = this.raceChangeAt(user.id);
      if (wait) {
        return { ok: false, error: `you can change your race again in ${Math.ceil((wait - this.now()) / DAY)} day(s). Your look can be changed any time.` };
      }
      newRace = race;
      changedAt = this.now();
    }
    this.repo.setAppearance(user.id, newRace, cleaned.look, changedAt);
    if (newRace !== current.race) {
      this.emitActivity(user, { kind: 'race', text: `became ${/^[aeiou]/i.test(RACES[newRace].name) ? 'an' : 'a'} ${RACES[newRace].icon} ${RACES[newRace].name}` });
      return { ok: true, message: `You are now ${RACES[newRace].icon} ${RACES[newRace].name}! Your next race change is in ${this.cfg.raceChangeDays ?? 30} days.` };
    }
    return { ok: true, message: 'Look saved!' };
  },

  // Everything the website's character page and customizer need.
  publicAppearance(userId) {
    const a = this.appearance(userId);
    if (!a) return null;
    const r = RACES[a.race];
    return { race: a.race, raceName: r.name, raceIcon: r.icon, pros: r.pros, cons: r.cons, look: a.look, custom: a.custom, raceChangeAt: this.raceChangeAt(userId), perksOn: this.cfg.racePerks !== false };
  },

  appearanceOptions() {
    return { options: publicOptions(), races: publicRaces(), raceChangeDays: this.cfg.raceChangeDays ?? 30, perksOn: this.cfg.racePerks !== false };
  },

  // !race: your race and what it does. "!race elf" describes another race.
  raceInfo(user, args = []) {
    const want = String(args[0] || '').toLowerCase();
    const id = RACE_IDS.find((r) => r === want || RACES[r].name.toLowerCase() === want);
    if (want && !id) return `races: ${RACE_IDS.map((r) => `${RACES[r].icon} ${RACES[r].name}`).join(', ')}. !race elf to see one.`;
    const mine = this.appearance(user.id).race;
    const r = RACES[id || mine];
    const perks = this.cfg.racePerks === false ? ' (race perks are switched off right now)' : ` ✅ ${r.pros.join(', ')} · ❌ ${r.cons.join(', ')}`;
    const who = id && id !== mine ? `${r.icon} ${r.name}:` : `you are ${/^[aeiou]/i.test(r.name) ? 'an' : 'a'} ${r.icon} ${r.name}.`;
    return `${who}${perks}. Change your race and look at ${this.siteUrl}/#/customize`;
  },
};
