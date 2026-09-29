const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { GameEngine } = require('../src/game/engine');
const { xpForLevel } = require('../src/game/xp');

const DAY = 86_400_000;

function setup({ rolls = [], game = {} } = {}) {
  const repo = openDb(':memory:');
  // A Monday at noon, so weeks are easy to follow.
  let t = Date.UTC(2026, 8, 28, 12);
  const queue = [...rolls];
  const config = {
    baseUrl: 'http://localhost:3000',
    game: { prefix: '!', staminaMax: 3, staminaMinutes: 0.5, racePerks: false, petDropMultiplier: 0, replyInChat: true, chatPoints: 0, chatCooldown: 60, tradeMinHours: 0, tradeMinActions: 0, ...game },
  };
  const engine = new GameEngine({ repo, config, rng: () => (queue.length ? queue.shift() : 0.99), now: () => t });
  const say = (content, username) => engine.handleChat({ kickUserId: username.toLowerCase(), username, content }).reply;
  const user = (name, points = 0) => {
    const u = repo.upsertUser({ kickUserId: name.toLowerCase(), username: name });
    if (points) repo.addPoints(u.id, points);
    return u;
  };
  const tick = (ms) => (t += ms);
  return { repo, engine, say, user, tick, queue, now: () => t };
}

test('heists: a successful stealth check robs without a fight; the fence takes a cut; the victim is safe for a while', () => {
  const s = setup({ rolls: [0.01] }); // stealth succeeds
  const rich = s.user('Rich', 100_000);
  const thief = s.user('Thief', 1_000);
  assert.match(s.say('!rob @Nobody', 'Thief'), /no adventurer/);
  assert.match(s.say('!rob @Thief', 'Rich'), /only rob players richer than you/);
  const reply = s.say('!rob @Rich', 'Thief');
  // 3% of 100,000 = 3,000; the fence keeps 20% (600).
  assert.match(reply, /slipped past @Rich unseen and got away with 2,400 pts \(the fence kept 600\)/);
  assert.equal(s.repo.getUser(rich.id).points, 97_000);
  assert.equal(s.repo.getUser(thief.id).points, 3_400);
  assert.equal(s.engine.vitals(thief.id).hp, s.engine.vitals(thief.id).maxHp, 'no fight, no damage');
  s.user('Other', 10);
  assert.match(s.say('!rob @Rich', 'Other'), /was robbed recently and is on guard/);
  s.tick(61 * 60_000);
  assert.match(s.say('!rob @Rich', 'Thief'), /robbed @Rich not long ago/);
  assert.equal(s.engine.pvpPage().heists.log[0].how, 'stealth');
});

test('heists: stealth is Agility against Agility, minus guards', () => {
  const s = setup();
  const rich = s.user('Rich', 200_000);
  const thief = s.user('Thief', 10_000);
  assert.equal(s.engine.heistChance(thief.id, rich.id), 0.45);
  s.repo.addXp(thief.id, 'agility', xpForLevel(51));
  assert.equal(Math.round(s.engine.heistChance(thief.id, rich.id) * 100), 65, '+0.4% per level ahead');
  s.repo.addXp(rich.id, 'agility', xpForLevel(51));
  assert.equal(s.engine.heistChance(thief.id, rich.id), 0.45, 'even again');
  // Guards: 0.5% of what you hold per guard per day (min 500); -12% stealth each.
  assert.match(s.say('!guards', 'Rich'), /no guards on duty.*1: 1,000, 2: 2,000, 3: 3,000/);
  assert.match(s.say('!hire', 'Rich'), /no guards on duty.*!hire <1-3> hires them/);
  assert.match(s.say('!hire 2 guards', 'Rich'), /hired 2 guards for 24h \(2,000 pts\)/);
  assert.equal(Math.round(s.engine.heistChance(thief.id, rich.id) * 100), 21);
  s.tick(DAY + 1);
  assert.equal(s.engine.guardLevel(rich.id), 0, 'guards leave after 24h');
});

test('heists: spotted robbers fight the victim; winning takes half, losing costs a fine and HP', () => {
  // Stealth fails (0.99); every swing after that hits hard (0.99).
  const s = setup({ rolls: [0.99] });
  const rich = s.user('Rich', 100_000);
  const thief = s.user('Thief', 10_000);
  s.repo.addXp(thief.id, 'swords', xpForLevel(40));
  s.repo.addItem(thief.id, 'steel_sword', 1);
  const reply = s.say('!rob @Rich', 'Thief');
  // Half of 3,000 = 1,500; the fence keeps 300.
  assert.match(reply, /@Rich spotted you, but you won the fight \(Swords 40, Steel Sword vs Fists 1, \d+ rounds, ❤️ \d+\/\d+ HP left\) and grabbed 1,200 pts \(the fence kept 300\)/);
  assert.equal(s.repo.getUser(rich.id).points, 98_500);
  assert.ok(s.engine.vitals(thief.id).hp < s.engine.vitals(thief.id).maxHp, 'the robber keeps their wounds');
  assert.equal(s.engine.pvpPage().heists.log[0].how, 'fight');

  // A weak robber against a strong victim: caught, fined, beaten up (1 HP, not knocked out).
  const s2 = setup({ rolls: [0.99] });
  const boss = s2.user('Boss', 200_000);
  const kid = s2.user('Kid', 10_000);
  s2.repo.addXp(boss.id, 'swords', xpForLevel(60));
  s2.repo.addItem(boss.id, 'mithril_sword', 1);
  assert.equal(s2.engine.pvpPage(kid.id).heists.mostWanted[0].fight, 'hopeless');
  const lost = s2.say('!rob @Boss', 'Kid');
  // Fine: 5% of 10,000 = 500; 250 to Boss, 250 removed.
  assert.match(lost, /@Boss caught you and won the fight .*Fined 500 pts \(half to them\) and you're lying low for 30m/);
  assert.equal(s2.repo.getUser(kid.id).points, 9_500);
  assert.equal(s2.repo.getUser(boss.id).points, 200_250);
  const v = s2.engine.vitals(kid.id);
  assert.equal(v.hp, 1);
  assert.equal(v.ko, false);
  assert.equal(s2.engine.vitals(boss.id).hp, s2.engine.vitals(boss.id).maxHp, "the victim isn't hurt (they may be offline)");
  assert.match(s2.say('!rob @Boss', 'Kid'), /lying low after a failed heist/);
});

test('pvp combat core: combat level sets accuracy, weapon skill and gear set damage, guards back up victims', () => {
  const s = setup();
  const a = s.user('Ann');
  const b = s.user('Bob');
  const ca = s.engine.pvpCombatant(a.id);
  const cb = s.engine.pvpCombatant(b.id);
  assert.equal(s.engine.pvpAccuracy(ca, cb), 0.75);
  s.repo.addXp(a.id, 'swords', xpForLevel(51));
  s.repo.addItem(a.id, 'bronze_sword', 1);
  const strong = s.engine.pvpCombatant(a.id);
  assert.equal(strong.combatLevel, 51);
  assert.equal(strong.skillLevel, 51);
  assert.ok(strong.attack > 0);
  assert.equal(s.engine.pvpAccuracy(strong, cb), 0.95);
  assert.equal(s.engine.pvpAccuracy(cb, strong), 0.55);
  assert.equal(s.engine.pvpOutlook(strong, cb), 'favoured');
  assert.equal(s.engine.pvpOutlook(cb, strong), 'hopeless');
  // Guards make a victim tougher in a heist fight.
  s.repo.addPoints(b.id, 100_000);
  const before = s.engine.heistFighters(a.id, b.id).victim;
  s.say('!hire 3', 'Bob');
  const after = s.engine.heistFighters(a.id, b.id).victim;
  assert.ok(after.maxHp === before.maxHp && after.defence >= before.defence);
});

test('heists respect the trading rules for new players and can be switched off', () => {
  const s = setup({ game: { tradeMinActions: 20 } });
  s.user('Rich', 100_000);
  s.user('New', 0);
  assert.match(s.say('!rob @Rich', 'New'), /can't rob other players yet/);
  s.engine.cfg.heistsEnabled = false;
  assert.match(s.say('!rob @Rich', 'New'), /switched off/);
});

test('ranked arena: Elo against the closest rating, entry fee into a weekly pot paid to the top 3', () => {
  const s = setup();
  const a = s.user('Ann', 5_000);
  const b = s.user('Bob', 5_000);
  s.repo.addXp(a.id, 'swords', xpForLevel(40));
  s.repo.addItem(a.id, 'bronze_sword', 1);
  s.repo.addXp(b.id, 'fishing', 10); // on the overall board
  const reply = s.say('!arena', 'Ann');
  assert.match(reply, /🏟️ WIN vs @Bob .*Rating 1016 \(\+16\) · 1W 0L · 9 ranked fights left today/);
  assert.equal(s.repo.getUser(a.id).points, 4_900, 'entry fee');
  assert.equal(s.engine.arena().pot, 90, '10% of the fee is removed');
  assert.equal(s.engine.arena().ratings[b.id].r, 984);
  assert.match(s.say('!arena top', 'Bob'), /1\. Ann 1016/);

  // Daily limit.
  s.engine.cfg.arenaFightsPerDay = 1;
  s.tick(60_000);
  assert.match(s.say('!arena', 'Ann'), /that's your 1 ranked fights for today/);

  // Next Monday: the pot is paid out, the champion gets a title, ratings move halfway back.
  s.tick(7 * DAY);
  s.engine.tick();
  assert.equal(s.repo.getUser(a.id).points, 4_900 + 45);
  assert.equal(s.repo.getUser(b.id).points, 5_000 + 27);
  assert.ok(s.engine.titles(a.id).includes('Arena Champion'));
  assert.equal(s.engine.arena().ratings[a.id].r, 1008);
  assert.equal(s.engine.arena().pot, 0);
});

test('guild wars: PvP wins against other guilds score; the winner gets bonus XP next week', () => {
  const s = setup({ rolls: [0.01] });
  const a = s.user('Ann', 50_000);
  const b = s.user('Bob', 200_000);
  s.engine.guildCreate(s.repo.getUser(a.id), 'Iron Wolves', 'IW');
  s.engine.guildCreate(s.repo.getUser(b.id), 'Gold Crows', 'GC');
  assert.match(s.say('!rob @Bob', 'Ann'), /slipped past @Bob unseen/);
  assert.match(s.say('!war', 'Ann'), /1\. \[IW\] 2/);
  const iw = s.repo.guildOf(a.id);
  assert.equal(s.engine.guildWarXp(a.id), 1);

  s.tick(7 * DAY);
  s.engine.tick();
  assert.equal(s.repo.getSetting('guildwar_last').guildId, iw.id);
  assert.ok(s.engine.titles(a.id).includes('Warlord'));
  assert.equal(s.engine.guildWarXp(a.id), 1.05);
  assert.equal(s.engine.guildWarXp(b.id), 1);
  // XP really is boosted.
  const before = s.repo.getSkills(a.id).agility;
  s.say('!run', 'Ann');
  assert.equal(s.repo.getSkills(a.id).agility - before, Math.round(11 * 1.05));
  // A week later the bonus ends.
  s.tick(7 * DAY);
  s.engine.tick();
  assert.equal(s.engine.guildWarXp(a.id), 1);
});

test('duels score for guild wars too, and the pvp page has everything', () => {
  const s = setup();
  const a = s.user('Ann', 50_000);
  const b = s.user('Bob', 50_000);
  s.engine.guildCreate(s.repo.getUser(a.id), 'Iron Wolves', 'IW');
  s.engine.guildCreate(s.repo.getUser(b.id), 'Gold Crows', 'GC');
  s.repo.addXp(a.id, 'swords', xpForLevel(40));
  s.repo.addItem(a.id, 'bronze_sword', 1);
  s.say('!duel @Bob', 'Ann');
  assert.match(s.say('!accept', 'Bob'), /@Ann WINS/);
  assert.equal(s.engine.guildWarStandings()[0].score, 1);
  const page = s.engine.pvpPage(a.id);
  assert.ok(page.heists.mostWanted.length && page.arena && page.war.standings.length);
});

test('heists: one player can only take so much a day', () => {
  const s = setup({ rolls: [0.01, 0.01, 0.01], game: { heistDailyLoot: 3000 } });
  s.user('RichA', 100_000);
  s.user('RichB', 100_000);
  s.user('RichC', 100_000);
  const thief = s.user('Thief', 10);
  assert.match(s.say('!rob @RichA', 'Thief'), /got away with 2,400/);
  s.tick(60_000);
  // Only 600 more allowed today: 750 taken, the fence keeps 150.
  assert.match(s.say('!rob @RichB', 'Thief'), /got away with 600 pts \(the fence kept 150\)/);
  s.tick(60_000);
  assert.match(s.say('!rob @RichC', 'Thief'), /the most allowed/);
  assert.equal(s.repo.getUser(thief.id).points, 3_010);
});
