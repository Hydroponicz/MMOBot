// GameEngine methods: races, perks and character looks. Mixed into GameEngine.prototype by engine.js.
const { RACES, RACE_IDS, randomCharacter, cleanLook, publicOptions, publicRaces } = require('../appearance');
const { ITEMS, SKILLS, SKILL_IDS } = require('../skills');
const { COSMETIC_SLOTS, PETS, PET_BONUS } = require('../content');
const { skillLevel, fmt } = require('./shared');

// Colors of gear materials, for drawing worn gear on the portrait.
const MATERIAL = {
  bronze: '#b87333', steel: '#a9b3bd', mithril: '#6f8fd6', adamant: '#3fa06a', rune: '#3fb6c9',
  obsidian: '#4a4452', orichalcum: '#d9a441', dragonite: '#c0392b', void: '#5b2d8c', celestial: '#f3e6a0',
  dwarven: '#8d99a6', orcish: '#6b5d4f', knights: '#c9ced6', elven: '#c9e6a0', soul: '#5ff2e6',
};
const materialOf = (id) => MATERIAL[id.split('_')[0]] || (/_(coif|body|chaps)$/.test(id) ? '#8a5a35' : '#9aa3ad');
// Cosmetic keys saved with the look; "none" means nothing worn.
const EXTRA_KEYS = [...COSMETIC_SLOTS, 'pet'];

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
    // Cosmetics and pets: must be owned, and the right kind for the slot.
    const inv = this.repo.getInventory(user.id);
    for (const key of EXTRA_KEYS) {
      const want = look?.[key];
      if (want === undefined) continue;
      if (want === null || want === 'none' || want === '') {
        cleaned.look[key] = 'none';
        continue;
      }
      const it = ITEMS[want];
      const fits = key === 'pet' ? it?.pet : it?.cosmetic?.slot === key;
      if (!fits || !inv[want]) return { ok: false, error: `you don't own that ${key}` };
      cleaned.look[key] = want;
    }
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

  // What the avatar draws: race, look, worn gear, cosmetics, pet and prestige stars.
  characterView(userId) {
    const a = this.appearance(userId);
    if (!a) return null;
    const worn = this.repo.getWorn(userId);
    const gear = {};
    for (const slot of ['head', 'body', 'shield']) if (worn[slot] && ITEMS[worn[slot]]) gear[slot] = materialOf(worn[slot]);
    if (worn.weapon && ITEMS[worn.weapon]) gear.weapon = { type: ITEMS[worn.weapon].weaponType || 'sword', color: materialOf(worn.weapon) };
    const inv = this.repo.getInventory(userId);
    const cosmetics = {};
    for (const slot of COSMETIC_SLOTS) {
      const id = a.look[slot];
      if (id && inv[id] && ITEMS[id]?.cosmetic?.slot === slot) cosmetics[slot] = ITEMS[id].cosmetic.style;
    }
    const pet = a.look.pet && inv[a.look.pet] && ITEMS[a.look.pet]?.pet ? ITEMS[a.look.pet].icon : null;
    return { race: a.race, look: a.look, gear, cosmetics, pet, stars: this.prestigeTotal(userId) };
  },

  // Cosmetics and pets the player owns (for the customizer).
  wardrobe(userId) {
    const inv = this.repo.getInventory(userId);
    const own = (test) => Object.keys(inv).filter((id) => inv[id] > 0 && ITEMS[id] && test(ITEMS[id])).map((id) => ({ id, name: ITEMS[id].name, icon: ITEMS[id].icon, style: ITEMS[id].cosmetic?.style }));
    return {
      ...Object.fromEntries(COSMETIC_SLOTS.map((slot) => [slot, own((i) => i.cosmetic?.slot === slot)])),
      pet: own((i) => i.pet).map((p) => ({ ...p, skill: SKILLS[ITEMS[p.id].pet.skill].name })),
    };
  },

  // Everything the website's character page and customizer need.
  publicAppearance(userId) {
    const a = this.appearance(userId);
    if (!a) return null;
    const r = RACES[a.race];
    return {
      ...this.characterView(userId),
      raceName: r.name,
      raceIcon: r.icon,
      pros: r.pros,
      cons: r.cons,
      custom: a.custom,
      raceChangeAt: this.raceChangeAt(userId),
      perksOn: this.cfg.racePerks !== false,
      wardrobe: this.wardrobe(userId),
      prestige: this.prestigeOf(userId),
    };
  },

  // ---- Pets -------------------------------------------------------------------------------
  // A tiny chance per successful action to find that skill's pet (once each).
  rollPet(user, skillId) {
    const pet = PETS.find((p) => p.skill === skillId);
    const mult = this.cfg.petDropMultiplier ?? 1;
    if (!pet || mult <= 0 || this.repo.getInventory(user.id)[pet.id]) return null;
    if (this.petRng() >= pet.chance * mult * this.luck(user.id)) return null;
    this.repo.addItem(user.id, pet.id, 1);
    this.recordFirst('pets', pet.id, user);
    // Their first pet follows them straight away.
    const a = this.appearance(user.id);
    if (!a.look.pet || a.look.pet === 'none') this.repo.setAppearance(user.id, a.race, { ...a.look, pet: pet.id }, a.raceChangedAt);
    this.emitActivity(user, { kind: 'pet', item: pet.id, text: `found a pet: ${pet.icon} ${pet.name}! (+${Math.round(PET_BONUS * 100)}% ${SKILLS[skillId].name} XP)` });
    this.notify?.(user.id, `${pet.icon} You found a pet: ${pet.name}! Choose your active pet on the Customize page.`);
    this.announce(`🐾 @${user.username} found a rare pet: ${pet.icon} ${pet.name}!`);
    return pet;
  },

  // XP multiplier from the active pet (+5% in its skill).
  petXp(userId, skillId) {
    const id = this.appearance(userId)?.look.pet;
    return id && ITEMS[id]?.pet?.skill === skillId && this.repo.getInventory(userId)[id] ? 1 + PET_BONUS : 1;
  },

  // !pet [name]: show your pets or pick the active one.
  petCommand(user, args = []) {
    const owned = this.wardrobe(user.id).pet;
    if (!owned.length) return `no pets yet. Every action has a tiny chance to find that skill's pet (${PETS.length} to collect)!`;
    const a = this.appearance(user.id);
    if (!args.length) {
      const active = owned.find((p) => p.id === a.look.pet);
      return `🐾 pets (${owned.length}/${PETS.length}): ${owned.map((p) => `${p.icon} ${p.name}`).join(', ')}.${active ? ` Following you: ${active.icon} ${active.name} (+${Math.round(PET_BONUS * 100)}% ${active.skill} XP).` : ''} !pet <name> to switch.`;
    }
    const q = args.join(' ').toLowerCase();
    const pick = owned.find((p) => p.name.toLowerCase().includes(q));
    if (!pick) return `you don't have a pet called "${q}".`;
    this.repo.setAppearance(user.id, a.race, { ...a.look, pet: pick.id }, a.raceChangedAt);
    return `${pick.icon} ${pick.name} is following you now (+${Math.round(PET_BONUS * 100)}% ${pick.skill} XP).`;
  },

  // ---- Prestige ---------------------------------------------------------------------------
  // At a high level a skill can be reset to level 1 for a permanent star and +5% XP in it.
  prestigeOf(userId) {
    const eq = this.repo.getEquipment(userId);
    return Object.fromEntries(SKILL_IDS.filter((id) => eq[`prestige_${id}`]).map((id) => [id, eq[`prestige_${id}`]]));
  },

  prestigeTotal(userId) {
    return Object.values(this.prestigeOf(userId)).reduce((s, n) => s + n, 0);
  },

  prestigeXp(userId, skillId) {
    return 1 + 0.05 * (this.repo.getEquipment(userId)[`prestige_${skillId}`] || 0);
  },

  // !prestige <skill> [confirm]
  prestige(user, args = []) {
    const need = this.cfg.prestigeLevel ?? 500;
    const max = 10;
    const p = this.cfg.prefix;
    const q = String(args[0] || '').toLowerCase();
    const skillId = SKILL_IDS.find((id) => id === q || SKILLS[id].name.toLowerCase() === q || SKILLS[id].command === q);
    const mine = this.prestigeOf(user.id);
    if (!skillId) {
      const list = Object.entries(mine).map(([id, n]) => `${SKILLS[id].icon}${'⭐'.repeat(Math.min(n, 5))}${n > 5 ? `x${n}` : ''}`).join(' ');
      return `prestige: reset a skill at level ${need} back to 1 for a permanent ⭐ and +5% XP in it (up to ${max} times). ${p}prestige mining to start.${list ? ` Yours: ${list}` : ''}`;
    }
    const skill = SKILLS[skillId];
    const level = skillLevel(skillId, this.repo.getSkills(user.id)[skillId]);
    const n = mine[skillId] || 0;
    if (n >= max) return `${skill.icon} ${skill.name} is already at max prestige (${max})!`;
    if (level < need) return `you need ${skill.icon} ${skill.name} level ${need} to prestige (you are ${level}).`;
    if (String(args[1] || '').toLowerCase() !== 'confirm') {
      return `⚠️ this resets ${skill.icon} ${skill.name} from level ${level} to 1 (you keep items, tools and gear) for ⭐ prestige ${n + 1} and +${5 * (n + 1)}% ${skill.name} XP forever. Type ${p}prestige ${skillId} confirm to do it.`;
    }
    this.repo.transaction(() => {
      this.repo.addXp(user.id, skillId, -this.repo.getSkills(user.id)[skillId]);
      this.repo.setEquipment(user.id, `prestige_${skillId}`, n + 1);
    });
    this.emitActivity(user, { kind: 'levelup', skill: skillId, text: `prestiged ${skill.name}! ⭐ x${n + 1}` });
    return `⭐ ${skill.name} prestige ${n + 1}! Back to level 1 with +${5 * (n + 1)}% ${skill.name} XP forever.`;
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
