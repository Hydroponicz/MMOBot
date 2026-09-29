// Stream rewards catalog: redemptions and community projects. Prices, cooldowns and goals here are the
// defaults; admins edit them in Settings (the "redemptions" and "projects" tables).

// id, name, icon, default cost, default cooldown (minutes, for the whole channel), what it does.
const REDEMPTIONS = [
  { id: 'fireworks', name: 'Fireworks', icon: '🎆', cost: 1000, cooldown: 1, text: 'Fireworks with your name light up the stream.' },
  { id: 'fanfare', name: 'Fanfare', icon: '📯', cost: 1500, cooldown: 2, text: 'Trumpets sound and the stream hails you by name.' },
  { id: 'spotlight', name: 'Spotlight', icon: '🔦', cost: 2500, cooldown: 2, text: 'Your character takes centre stage, with your title and level.' },
  { id: 'goblin', name: 'Release a treasure goblin', icon: '👺', cost: 5000, cooldown: 10, text: 'A treasure goblin appears in chat: first to !catch it wins its loot.' },
  { id: 'xp', name: 'Double XP for everyone (10 min)', icon: '⚡', cost: 20000, cooldown: 60, text: 'Everyone in chat gets double XP for 10 minutes.' },
  { id: 'raid', name: 'Summon a raid boss', icon: '🐉', cost: 30000, cooldown: 45, text: 'A giant raid boss attacks: chat has to !attack it together.' },
];
// Community projects, in the order they rotate. goal = default points needed.
const PROJECTS = [
  { id: 'monument', name: 'Raise a Monument', icon: '🏛️', goal: 50000, text: "The top donor's character is carved into the Hall of Monuments on the website, forever." },
  { id: 'xp', name: 'Double XP Hour', icon: '⚡', goal: 60000, text: 'Everyone gets double XP for an hour.' },
  { id: 'fortune', name: 'Festival of Fortune', icon: '🍀', goal: 40000, text: 'Rare finds are twice as likely for everyone for an hour.' },
  { id: 'worldboss', name: 'Awaken the World Boss', icon: '🌍', goal: 100000, text: 'Summons the world boss: the whole community fights it for days for a big reward pool.' },
];
module.exports = { REDEMPTIONS, PROJECTS };
