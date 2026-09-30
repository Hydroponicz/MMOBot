// Live game settings, editable from the admin page.
//
// Defaults come from environment variables (config.js) and the game data (game/skills.js). Anything the
// admin changes is stored in the database as an override and wins over the defaults, so changes apply
// immediately and survive redeploys. Kick credentials, URLs and paths stay environment-only.
const { EventEmitter } = require('node:events');
const { ITEMS, SKILLS, SKILL_IDS, BACKPACK_TIERS, SHOP, COMMAND_TO_SKILL } = require('./game/skills');
const { isChatCommand } = require('./game/engine');
const { parseEmoteCommands, formatShortcut } = require('./game/emotes');
const { REDEMPTIONS, PROJECTS } = require('./game/streamRewards');
const { HOUSES } = require('./game/houses');

// Every command a viewer can type (without the prefix), for enabling/disabling from the admin page.
const TOOL_SKILLS = SKILL_IDS.filter((id) => SKILLS[id].tool);
const COMMANDS = [
  ...Object.keys(COMMAND_TO_SKILL),
  'upgrade',
  'gear',
  'equip',
  'unequip',
  'equipped',
  'shop',
  'buy',
  'plant',
  'harvest',
  'farm',
  'collect',
  'hp',
  'drink',
  'heal',
  'eat',
  'monsters',
  'targets',
  'casino',
  'slots',
  'roulette',
  'plinko',
  'blackjack',
  'crash',
  'mines',
  'cards',
  'relics',
  'redeem',
  'project',
  'raid',
  'boost',
  'season',
  'quest',
  'item',
  'open',
  'pet',
  'prestige',
  'goal',
  'market',
  'enchant',
  'bounty',
  'dungeon',
  'guild',
  'hall',
  'duel',
  'rob',
  'pickpocket',
  'poach',
  'burgle',
  'wanted',
  'jailbreak',
  'tipoff',
  'racket',
  'house',
  'arena',
  'veil',
  'war',
  'catch',
  'daily',
  'give',
  'craft',
  'museum',
  'title',
  ...TOOL_SKILLS.map((id) => SKILLS[id].tool.id),
  'stats',
  'inv',
  'sell',
  'price',
  'points',
  'top',
  'commands',
];

// Editable scalar fields, grouped into sections. The admin page renders its form from this.
const FIELDS = {
  general: {
    prefix: { type: 'string', label: 'Command prefix', help: 'What commands start with, e.g. ! for !fish.', maxLength: 3 },
    staminaMax: { type: 'int', label: 'Stamina charges', help: 'How many actions a viewer can take before resting. Every game action (skilling, fighting, farming, raid !attack) uses one charge.', min: 1, max: 100 },
    racePerks: { type: 'bool', label: 'Race perks', help: 'Races give perks and drawbacks (XP, HP, attack, sell prices...). Off = races are just for looks.' },
    raceChangeDays: { type: 'int', label: 'Race change wait (days)', help: 'How often a player can pick a new race on the website. Their look can be changed any time.', min: 0, max: 365 },
    foodHealCap: { type: 'number', label: 'Food: most one meal can heal (share of max HP)', help: '0.3 = a meal heals at most 30% of your max HP, however good the food.', min: 0.05, max: 1 },
    healManaCost: { type: 'number', label: '!heal mana cost (share of max mana)', help: '0.3 = each cast uses 30% of your max mana.', min: 0.05, max: 1 },
    healBase: { type: 'number', label: '!heal strength (share of max HP)', help: 'Base heal; +0.1% per Magic level on top (up to +30%).', min: 0.05, max: 1 },
    staminaGradual: { type: 'bool', label: 'Stamina: refill one charge at a time', help: 'Off: the whole bar refills at once, the refill time after the first charge is used. On: one charge comes back every (refill time ÷ charges).' },
    prestigeLevel: { type: 'int', label: 'Prestige level', help: 'Skill level needed to !prestige (reset a skill for a star and +5% XP in it). Default 500, the max level.', min: 2, max: 500 },
    staminaMinutes: { type: 'number', label: 'Stamina refill (minutes)', help: 'The bar fills back up to full this long after the first charge is used.', min: 0.05, max: 1440 },
    hpRegenHours: { type: 'int', label: 'HP regen (hours)', help: 'Hours to go from 0 to full HP. Knocked-out players can fight again after this, or right away with a health potion.', min: 1, max: 168 },
    manaRegenHours: { type: 'int', label: 'Mana regen (hours)', help: 'Hours to go from 0 to full mana.', min: 1, max: 168 },
    chatPoints: { type: 'int', label: 'Points for chatting', help: 'Points for talking in chat (any message).', min: 0, max: 100000 },
    chatCooldown: { type: 'int', label: 'Chat points cooldown (seconds)', help: 'How often chatting can earn points.', min: 0, max: 86400 },
    chatPointsFullPerDay: { type: 'int', label: 'Chat points: full awards per day', help: 'A player gets full chat points this many times a day (with the default 60s cooldown, 30 = half an hour of active chatting), then half after that. Keeps marathon chatting from flooding the economy. 0 = always full.', min: 0, max: 100000 },
    chatPointsMinChars: { type: 'int', label: 'Chat points: minimum message length', help: 'Messages shorter than this (letters, not counting emotes) earn no chat points. Stops "a" spam.', min: 0, max: 100 },
    chatPointsNoRepeats: { type: 'bool', label: 'Chat points: ignore repeats', help: 'Sending the same message twice in a row earns nothing the second time.' },
    chatPointsNewUserMinutes: { type: 'int', label: 'Chat points: new chatter wait (minutes)', help: 'New chatters earn chat points only after this long (0 = right away). Makes throwaway alt accounts less useful.', min: 0, max: 10080 },
    subChatMultiplier: { type: 'number', label: 'Subscriber chat points multiplier', help: 'Subscribers (sub badge in chat) earn this many times the chat points.', min: 1, max: 10 },
    replyInChat: { type: 'bool', label: 'Reply in chat', help: 'Turn off to play silently (site and overlay still update).' },
    emoteCommands: {
      type: 'emotes',
      label: 'Emote shortcuts',
      help: 'emote=command pairs, comma separated, e.g. hydroponiczcobble=mine makes the emote work like !mine. Viewers can add a target after the emote (the emote then "iron" mines iron), or fix one here: cobble=mine iron.',
    },
    adminUsers: { type: 'list', label: 'Extra admins', help: 'Kick usernames (comma separated) allowed on this page. The channel owner is always admin.' },
  },
  casino: {
    casinoEnabled: { type: 'bool', label: 'Casino open', help: 'Slots, roulette, plinko and blackjack (chat and website). Points only.' },
    casinoMinBet: { type: 'int', label: 'Minimum bet', help: 'Smallest bet allowed.', min: 1, max: 1e12 },
    casinoMaxBet: { type: 'int', label: 'Maximum bet (0 = no limit)', help: 'Bigger bets (including "all") are capped to this.', min: 0, max: 1e12 },
    casinoCooldown: { type: 'int', label: 'Casino cooldown (seconds)', help: 'Time between bets per viewer.', min: 0, max: 3600 },
    plinkoDropMs: { type: 'int', label: 'Plinko: website drop cooldown (ms)', help: 'On the website the Drop button can be spammed: this is the shortest gap between drops. Chat !plinko uses the normal casino cooldown.', min: 0, max: 60000 },
    plinkoMaxBalls: { type: 'int', label: 'Plinko: most balls per drop', help: 'Players can drop many balls at once (the bet is per ball; one drop counts as one bet for the cooldown).', min: 1, max: 1000 },
    cardsEnabled: { type: 'bool', label: 'Trading cards open', help: 'Card packs, grading, the card market and card trades on the website.' },
    cardPackPriceMultiplier: { type: 'number', label: 'Card pack price multiplier', help: 'Scales every pack price (1 = normal: Scout 200, Booster 1,000, Elite 3,500, Mythic Vault 11,000).', min: 0.1, max: 100 },
    relicsEnabled: { type: 'bool', label: 'Relic cases open', help: 'Relic case opening, trade-up contracts, the relic market and relic trades on the website.' },
    relicCasePriceMultiplier: { type: 'number', label: 'Relic case price multiplier', help: 'Scales every case price (1 = normal, about 900-1,000 pts a case).', min: 0.1, max: 100 },
    relicBuyback: { type: 'number', label: 'Relic buyback rate (0-1)', help: 'Share of a relic’s value the bank pays when a player sells it back. Cases return about 88% of their price in relic value.', min: 0, max: 1 },
    bankDailyLimit: { type: 'int', label: 'Bank sell-back limit per day', help: 'Most points one player can get per day from selling cards and relics back to the bank (both together). Bigger items have to go through the player market, which moves points between players instead of creating them. 0 = no limit.', min: 0, max: 1e12 },
    bankFullValue: { type: 'int', label: 'Bank pays the full rate up to', help: 'The buyback rate applies to the first this-many points of an item’s value; the bank pays a fifth of the rate on anything above. Stops one jackpot item from flooding the economy.', min: 0, max: 1e12 },
    cardBuyback: { type: 'number', label: 'Card buyback rate (0-1)', help: 'Share of a card’s value the bank pays when a player sells it back. 0.6 = 60%. Packs return about 88% of their price in card value, so this is the points sink.', min: 0, max: 1 },
  },
  events: {
    followPoints: { type: 'int', label: 'Points for a new follow', help: 'Given once per viewer when they follow the channel.', min: 0, max: 1e9 },
    followMessages: { type: 'bool', label: 'Follow thank-you messages', help: 'The "Thanks for the follow" chat message and the follow on the feed/overlay. Switch off while the channel is being follow-botted.' },
    followFloodPerMinute: { type: 'int', label: 'Follow flood guard (follows per minute)', help: 'More follows than this in a minute (a follow-bot wave) and the thank-you messages go quiet until it calms down (10 minutes with no flood). 0 = no guard.', min: 0, max: 1000 },
    subPoints: { type: 'int', label: 'Points for a sub or resub', help: 'Given to the subscriber.', min: 0, max: 1e9 },
    giftPointsPerSub: { type: 'int', label: 'Points per gifted sub (to the gifter)', help: 'Each gifted sub also gives the person receiving it the sub points.', min: 0, max: 1e9 },
    giftBoostMinutesPerSub: { type: 'int', label: 'Double XP minutes per gifted sub', help: 'Gifted subs start a channel-wide XP boost (0 = off). Capped at 60 minutes.', min: 0, max: 60 },
    giftBoostMultiplier: { type: 'number', label: 'Gifted-sub XP boost', help: 'XP multiplier during that boost (2 = double XP).', min: 1, max: 10 },
    eventsOnlyWhenLive: { type: 'bool', label: 'Random events and raids only when live', help: 'Needs Kick live status (the bot subscribes to it); if the stream status is unknown, events run anyway.' },
    randomEventMinutes: { type: 'int', label: 'Random chat events every (minutes)', help: 'A treasure goblin or supply drop appears about this often while chat is active (0 = off).', min: 0, max: 1440 },
    raidEveryMinutes: { type: 'int', label: 'Raid boss every (minutes)', help: 'A world boss appears this often (0 = only when you start one on the Events page).', min: 0, max: 1440 },
    raidMinutes: { type: 'int', label: 'Raid length (minutes)', help: 'How long chat has to beat the boss before it escapes.', min: 1, max: 60 },
    raidHpPerChatter: { type: 'number', label: 'Raid boss HP per chatter', help: "Boss HP = the monster's HP × this × active chatters (at least 3). Raise it if raids die too fast.", min: 0.1, max: 100 },
    worldBossHpMultiplier: { type: 'int', label: 'World boss HP multiplier', help: "World boss HP = the monster's HP × this. It's meant to take several streams.", min: 1, max: 100000 },
    worldBossDays: { type: 'int', label: 'World boss length (days)', help: 'How long the world boss stays before it escapes. Its HP carries over between streams.', min: 1, max: 60 },
    autoGoalTarget: { type: 'int', label: 'Auto channel goal (actions)', help: 'When the stream goes live, start a goal of this many actions for 2x XP for 30 minutes. 0 = off.', min: 0, max: 1000000 },
    raidRewardPoints: { type: 'int', label: 'Raid reward pool (points)', help: 'Split between everyone who hit the boss, by damage dealt.', min: 0, max: 1e9 },
    redeemEnabled: { type: 'bool', label: 'Stream redemptions', help: 'Players spend points on fireworks, a spotlight, a fanfare, double XP, a raid boss... (prices in the Stream redemptions table below).' },
    redeemOnlyLive: { type: 'bool', label: 'Redemptions only while live', help: 'Needs Kick live status; if the stream status is unknown, redemptions work anyway.' },
    projectsEnabled: { type: 'bool', label: 'Community projects', help: 'Chat pools points toward a shared goal (!fund). Goals in the Community projects table below.' },
    duelsEnabled: { type: 'bool', label: 'Duels', help: '!duel @name [bet]: player vs player fights for points.' },
    coffeeSeedsPerGiftedSub: { type: 'int', label: 'Coffee seeds per gifted sub', help: 'Gifting subs is the only way to get Coffee seeds (Trail Brew: +1 stamina charge). 0 = none.', min: 0, max: 100 },
    trailBrewCooldownMinutes: { type: 'int', label: 'Trail Brew cooldown (minutes)', help: 'How often a player can drink a Trail Brew.', min: 0, max: 10080 },
    townEnabled: { type: 'bool', label: 'The town', help: '!town / !contribute: chat builds town buildings from Construction parts; each level gives everyone bonus XP in its skills.' },
    townXpPerLevel: { type: 'number', label: 'Town: XP bonus per building level', help: '0.02 = +2% XP in the building\'s skills per level (5 levels).', min: 0, max: 0.5 },
    townGoalMultiplier: { type: 'number', label: 'Town: parts needed (multiplier)', help: 'Scales the parts value each town level needs (1 = 3k, 12k, 40k, 120k, 350k pts of parts).', min: 0.01, max: 100 },
    shopsEnabled: { type: 'bool', label: 'Player shops', help: '!stall build: players build a Market Stall, Shop or Emporium from Construction parts for more market listings and a lower fee.' },
    housesEnabled: { type: 'bool', label: 'Houses', help: '!house: end-game homes that add stamina charges (prices, charges and levels in the Houses table below).' },
    heistsEnabled: { type: 'bool', label: 'Heists', help: '!rob @name: rob players richer than you. !guards protects you.' },
    heistMinTarget: { type: 'int', label: 'Heists: minimum target points', help: 'Only players holding at least this many points can be robbed.', min: 0, max: 1e12 },
    heistStealPct: { type: 'number', label: 'Heists: share taken', help: 'A successful heist takes this share of the victim\'s points (0.03 = 3%).', min: 0, max: 0.5 },
    heistMaxSteal: { type: 'int', label: 'Heists: most taken per heist', help: 'Cap on one heist.', min: 0, max: 1e12 },
    heistFencePct: { type: 'number', label: 'Heists: fence cut (removed)', help: 'Share of every heist that disappears instead of going to the robber (0.2 = 20%).', min: 0, max: 1 },
    heistFinePct: { type: 'number', label: 'Heists: fine when caught', help: 'Share of the robber\'s own points they pay when caught (min 100). Half goes to the victim, half is removed.', min: 0, max: 1 },
    heistMaxFine: { type: 'int', label: 'Heists: biggest fine', help: 'Cap on one fine.', min: 0, max: 1e12 },
    heistStealthBase: { type: 'number', label: 'Heists: base stealth chance', help: 'Chance to rob without being noticed, before Agility and guards (-12% each). Always 5% to 90%. If it fails, robber and victim fight (combat level, weapon skill and gear).', min: 0, max: 1 },
    heistStealthPerLevel: { type: 'number', label: 'Heists: stealth per Agility level', help: 'Stealth chance added per Agility level the robber has over the victim (0.004 = 0.4%).', min: 0, max: 0.1 },
    heistMugPct: { type: 'number', label: 'Heists: share taken after winning a fight', help: 'A robber who is spotted but wins the fight takes this share of a sneaky heist\'s haul (0.5 = half).', min: 0, max: 1 },
    heistGuardFightBonus: { type: 'number', label: 'Heists: guard fight bonus', help: 'Each hired guard adds this much to the victim\'s attack and defence in a heist fight (0.15 = +15%).', min: 0, max: 5 },
    heistProtectMinutes: { type: 'int', label: 'Heists: victim protection (minutes)', help: 'After being robbed, nobody can rob that player for this long.', min: 0, max: 10080 },
    heistJailMinutes: { type: 'int', label: 'Heists: lying low after getting caught (minutes)', help: 'A caught robber can\'t rob again for this long.', min: 0, max: 10080 },
    heistSameTargetHours: { type: 'number', label: 'Heists: same target wait (hours)', help: 'How long before a robber can hit the same player again.', min: 0, max: 720 },
    heistDailyLoot: { type: 'int', label: 'Heists: most one player can take a day', help: 'Stops heists being used to move points from a main account into an alt. 0 = no cap.', min: 0, max: 1e12 },
    heistGuardPct: { type: 'number', label: 'Heists: guard price', help: 'Each guard costs this share of your points for 24h (min 500). 0.005 = 0.5% per guard, so the rich pay the most.', min: 0, max: 0.2 },
    pickpocketEnabled: { type: 'bool', label: 'Crime: pickpocketing', help: '!pickpocket @name: steal 1-3 of a random ordinary item from their backpack (never gear, tools, pets or cosmetics).' },
    poachEnabled: { type: 'bool', label: 'Crime: crop poaching', help: '!poach @name: steal up to 3 ready crops from their farm. A Scarecrow in their backpack (Construction) makes it harder.' },
    burglaryEnabled: { type: 'bool', label: 'Crime: shop burglary', help: '!burgle @name: take goods off a player shop\'s shelf (bigger shops have better locks).' },
    wantedEnabled: { type: 'bool', label: 'Crime: wanted posters', help: '!wanted @name 1000: put points on a criminal\'s head; whoever beats them in a heist fight, the arena or the Gloamveil collects (10% removed). Unclaimed after a week: 90% refunded.' },
    jailbreakEnabled: { type: 'bool', label: 'Crime: jailbreaks and bail', help: '!jailbreak @name busts a friend out of jail (Agility helps, guildmates +10%; fail and you\'re jailed too). !bail pays your way out.' },
    tipoffsEnabled: { type: 'bool', label: 'Crime: tip-offs', help: '!tipoff @name (100 pts): if they try a crime in the next 10 minutes they\'re caught, and the snitch gets a quarter of the fine.' },
    racketsEnabled: { type: 'bool', label: 'Crime: protection rackets', help: 'Guild leaders sell protection (!racket price 2000); robbing a client means beating the guild\'s strongest member first.' },
    crimeMinTargetLevel: { type: 'int', label: 'Crime: new player shield (character level)', help: 'Pickpocketing, poaching and burglary can\'t target players below this character level.', min: 0, max: 120 },
    crimeDailyLimit: { type: 'int', label: 'Crime: item crimes per day', help: 'Most pickpockets, poaches and burglaries one player can try a day. 0 = no limit.', min: 0, max: 1000 },
    wantedMin: { type: 'int', label: 'Crime: smallest bounty', help: 'Smallest amount for a wanted poster.', min: 1, max: 1e12 },
    bailPct: { type: 'number', label: 'Crime: bail (share of points)', help: 'Bail costs this share of your points (min 200, max 20,000). 0.02 = 2%.', min: 0, max: 1 },
    racketMaxPrice: { type: 'int', label: 'Crime: most a guild can charge for protection', help: 'Per 24h. Payments count toward the daily gift limit.', min: 0, max: 1e12 },
    veilEnabled: { type: 'bool', label: 'The Gloamveil', help: '!veil: the extraction minigame. Go in wearing your gear, loot, get out through a Waystone. Dying loses your worn gear, supplies and loot.' },
    veilMinutes: { type: 'int', label: 'Gloamveil: minutes before the fog closes', help: 'Still inside when time runs out = dead.', min: 3, max: 120 },
    veilBagSize: { type: 'int', label: 'Gloamveil: bag size', help: 'Most loot a player can carry out of one run.', min: 1, max: 100 },
    veilLootMultiplier: { type: 'number', label: 'Gloamveil: loot multiplier', help: 'Scales how much each search finds (1 = normal).', min: 0.1, max: 10 },
    veilPvpChance: { type: 'number', label: 'Gloamveil: chance to spot a player', help: 'Base chance per search or move to spot another player in the same zone (noise adds to it).', min: 0, max: 1 },
    veilSamePairHours: { type: 'number', label: 'Gloamveil: same pair loot wait (hours)', help: 'Two players who fought in the fog within this long: the loser\'s things are destroyed instead of going to the winner (stops feeding alts).', min: 0, max: 720 },
    veilActionSeconds: { type: 'int', label: 'Gloamveil: seconds between actions', help: 'Cooldown between !search, !deeper and other actions inside.', min: 0, max: 120 },
    arenaEnabled: { type: 'bool', label: 'Ranked arena', help: '!arena: rated fights against the closest-rated player, a weekly ladder and prize pot.' },
    arenaFee: { type: 'int', label: 'Arena entry fee', help: 'Points per ranked fight. Goes to the weekly prize pot (top 3 get 50/30/20%).', min: 0, max: 1e9 },
    arenaFightsPerDay: { type: 'int', label: 'Arena fights per day', help: 'Ranked fights a player can do each day.', min: 1, max: 1000 },
    arenaBurnPct: { type: 'number', label: 'Arena fee cut (removed)', help: 'Share of each entry fee removed from the game instead of going to the pot.', min: 0, max: 1 },
    guildWarsEnabled: { type: 'bool', label: 'Guild wars', help: 'Guilds score war points when members beat other guilds\' members (arena 3, heist 2, duel 1). Weekly winner gets bonus XP.' },
    guildWarXpBonus: { type: 'number', label: 'Guild war XP bonus', help: 'Extra XP for the winning guild\'s members the next week (0.05 = +5%).', min: 0, max: 1 },
    tradingEnabled: { type: 'bool', label: 'Trading', help: '!give @name <item> or !give @name 500: players give each other items and points.' },
    tradeMinHours: { type: 'int', label: 'Trading: hours since first chat', help: 'Both players must have been around this long (stops brand-new alt accounts).', min: 0, max: 8760 },
    seasonDays: { type: 'int', label: 'Season length (days)', help: 'Seasons end by themselves after this many days: the top 3 get a title and a season-only cosmetic. 0 = only when you end one on the Events page.', min: 0, max: 365 },
    tradeMinActions: { type: 'int', label: 'Trading: minimum actions', help: 'Both players need this many skilling actions.', min: 0, max: 1e6 },
    tradeDailyPoints: { type: 'int', label: 'Trading: points a player can give per day', help: '0 = no limit.', min: 0, max: 1e12 },
  },
  economy: {
    xpMultiplier: { type: 'number', label: 'XP multiplier', help: '2 = double XP event.', min: 0.1, max: 100 },
    pointsMultiplier: { type: 'number', label: 'Action points multiplier', help: 'Scales the points earned per skilling action.', min: 0, max: 100 },
    petDropMultiplier: { type: 'number', label: 'Pet drop rate multiplier', help: '1 = about 1 in 2,500 actions per skill. 0 turns pet drops off.', min: 0, max: 100 },
    marketFee: { type: 'number', label: 'Market fee (0-0.5)', help: 'Share of each market sale that disappears (a points sink). 0.05 = 5%.', min: 0, max: 0.5 },
    sellMultiplier: { type: 'number', label: 'Sell price multiplier', help: 'Scales what items sell for with !sell.', min: 0, max: 100 },
    growMultiplier: { type: 'number', label: 'Crop growth time multiplier', help: '0.5 = crops grow twice as fast (applies to new plantings).', min: 0.01, max: 100 },
    priceSupplyScale: { type: 'int', label: 'Sell prices: supply sensitivity', help: 'How much channel-wide selling it takes to push an item’s price down: after this many points’ worth of one item is sold (at normal prices), it sells at half price. Lower = prices drop faster. 0 = prices never change.', min: 0, max: 1e12 },
    priceRecoveryHours: { type: 'number', label: 'Sell prices: recovery (hours)', help: 'Sell pressure halves every this many hours, so prices recover on their own.', min: 0.1, max: 720 },
    priceFloor: { type: 'number', label: 'Sell prices: lowest (0-1)', help: 'Prices never drop below this share of normal. 0.35 = 35%.', min: 0.01, max: 1 },
    agilityRefillPerLevel: { type: 'number', label: 'Agility: faster stamina refill per level', help: 'How much faster stamina refills per Agility level. 0.001 = 0.1% per level (10% faster at level 100).', min: 0, max: 0.05 },
    agilityRefillMax: { type: 'number', label: 'Agility: most refill speed-up', help: 'The cap on the Agility speed-up. 0.5 = stamina refills in half the time (twice the actions per hour) at the top, reached at level 500 with the default rate.', min: 0, max: 0.9 },
    agilityShortcutChance: { type: 'number', label: 'Agility: shortcut chance', help: 'Chance an Agility lap costs no stamina (0.05 = 5%).', min: 0, max: 1 },
    stationXpBonus: { type: 'number', label: 'Gathering station XP multiplier', help: '!collect turns station work into XP only (no items, no points). 1.2 = 20% more XP than gathering the same things by hand.', min: 0, max: 10 },
    gatherBonusLevels: { type: 'int', label: 'Bigger gathering hauls every (levels)', help: 'Fishing, mining, woodcutting, digging and the like give +1 item (and its XP) per action for every this many levels: 2 at level 50, 3 at level 100. 0 turns it off.', min: 0, max: 1000 },
    plotsPerStamina: { type: 'int', label: 'Farm plots per stamina charge', help: 'Planting or harvesting uses 1 stamina charge per this many plots (70 plots = 3 charges). 0 = any number of plots for 1 charge.', min: 0, max: 1000 },
    fireMealsBase: { type: 'int', label: 'Meals per fire', help: 'How many meals one fire can cook (plus Firemaking below). Each fire costs a stamina charge.', min: 1, max: 10000 },
    fireMealsPerLevels: { type: 'int', label: 'Extra meal per Firemaking levels', help: 'One more meal per fire for every this many Firemaking levels (2 = +1 per 2 levels). 0 = off.', min: 0, max: 1000 },
    plotPriceGrowth: { type: 'number', label: 'Farm plot price growth', help: 'Each farm plot costs this many times the one before (the first bought plot costs the shop price). 1.12 = 12% more each: plot 10 ≈ 1,900, plot 20 ≈ 5,800, plot 30 ≈ 18,000, plot 50 ≈ 173,000. 1 = flat price.', min: 1, max: 3 },
  },
};

// Editable tables: one row per tier. Names/icons come from the game data and aren't editable here.
// One table per skill tool ("rods", "pickaxes", "axes", "shovels", "furnaces") plus the backpack.
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const STAT_COLUMNS = {
  failChance: (tool) => ({ type: 'number', label: `${cap(tool.failWord || 'fail')} chance (0-1)`, min: 0, max: 1 }),
  xpBonus: () => ({ type: 'number', label: 'XP bonus (0.1 = +10%)', min: 0, max: 100 }),
  rareBonus: () => ({ type: 'number', label: 'Rare odds ×', min: 0, max: 100 }),
  doubleChance: () => ({ type: 'number', label: 'Double chance (0-1)', min: 0, max: 1 }),
};
const TABLES = {};
for (const id of TOOL_SKILLS) {
  const skill = SKILLS[id];
  const tool = skill.tool;
  TABLES[`${tool.id}s`] = {
    label: `${skill.name} ${tool.name.toLowerCase()}s`,
    tool: true,
    ascending: 'level',
    columns: {
      level: { type: 'int', label: `${skill.name} level`, min: 1, max: skill.maxLevel || 99 },
      cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
      ...Object.fromEntries(tool.stats.map((stat) => [stat, STAT_COLUMNS[stat](tool)])),
    },
    rows: () => tool.tiers,
  };
}
TABLES.backpack = {
  label: 'Backpack',
  ascending: 'capacity',
  columns: {
    capacity: { type: 'int', label: 'Slots', min: 1, max: 100000 },
    cost: { type: 'int', label: 'Cost (points)', min: 0, max: 1e12 },
  },
  rows: () => BACKPACK_TIERS,
};
TABLES.shop = {
  label: 'Shop prices',
  // Saved rows are matched to items by id, so adding items anywhere never moves a saved price.
  key: 'item',
  columns: { cost: { type: 'int', label: 'Price (points)', min: 0, max: 1e12 } },
  rows: () => SHOP.map((x) => ({ ...x, name: ITEMS[x.item].name, icon: ITEMS[x.item].icon })),
};

TABLES.redemptions = {
  label: 'Stream redemptions',
  key: 'id',
  columns: {
    cost: { type: 'int', label: 'Price (points, 0 = off)', min: 0, max: 1e12 },
    cooldown: { type: 'int', label: 'Cooldown for the channel (minutes)', min: 0, max: 1440 },
  },
  rows: () => REDEMPTIONS,
};
TABLES.houses = {
  label: 'Houses',
  key: 'id',
  columns: {
    cost: { type: 'int', label: 'Price (points, 0 = not for sale)', min: 0, max: 1e15 },
    charges: { type: 'int', label: 'Extra stamina charges', min: 0, max: 100 },
    level: { type: 'int', label: 'Character level needed', min: 1, max: 120 },
  },
  rows: () => HOUSES,
};
TABLES.projects = {
  label: 'Community projects',
  key: 'id',
  columns: { goal: { type: 'int', label: 'Goal (points, 0 = skip)', min: 0, max: 1e12 } },
  rows: () => PROJECTS,
};

class SettingsError extends Error {}

function coerce(spec, value, label) {
  switch (spec.type) {
    case 'bool':
      if (typeof value === 'boolean') return value;
      if (value === 'true' || value === 'false') return value === 'true';
      throw new SettingsError(`${label} must be on or off`);
    case 'string': {
      const s = String(value ?? '').trim();
      if (!s) throw new SettingsError(`${label} can't be empty`);
      if (spec.maxLength && s.length > spec.maxLength) throw new SettingsError(`${label} is too long`);
      if (/\s/.test(s)) throw new SettingsError(`${label} can't contain spaces`);
      return s;
    }
    case 'list': {
      const arr = Array.isArray(value) ? value : String(value ?? '').split(',');
      return [...new Set(arr.map((x) => String(x).trim().toLowerCase().replace(/^@/, '')).filter(Boolean))];
    }
    case 'emotes': {
      // Same rules as EMOTE_COMMANDS: "name=command", optionally with a fixed target ("cobble=mine iron").
      const { shortcuts, errors } = parseEmoteCommands(value, isChatCommand);
      if (errors.length) throw new SettingsError(`${label}: ${errors[0]} (commands: ${Object.keys(COMMAND_TO_SKILL).join(', ')}, …)`);
      return shortcuts.map(formatShortcut);
    }
    case 'int':
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new SettingsError(`${label} must be a number`);
      if (spec.type === 'int' && !Number.isInteger(n)) throw new SettingsError(`${label} must be a whole number`);
      if (n < spec.min || n > spec.max) throw new SettingsError(`${label} must be between ${spec.min} and ${spec.max}`);
      return n;
    }
    default:
      throw new SettingsError(`unknown setting type for ${label}`);
  }
}

// EMOTE_COMMANDS, cleaned up like the admin page does. Bad entries are skipped with a warning
// instead of silently never matching (or matching everything).
function envEmotes(list) {
  const { shortcuts, errors } = parseEmoteCommands(list || [], isChatCommand);
  for (const e of errors) console.warn(`[settings] EMOTE_COMMANDS: skipping ${e}`);
  return shortcuts.map(formatShortcut);
}

class Settings extends EventEmitter {
  constructor({ config, repo }) {
    super();
    this.config = config;
    this.repo = repo;
    this.defaults = {
      general: {
        prefix: config.game.prefix,
        staminaMax: config.game.staminaMax ?? 3,
        staminaMinutes: config.game.staminaMinutes ?? 5,
        racePerks: config.game.racePerks ?? true,
        staminaGradual: config.game.staminaGradual ?? false,
        foodHealCap: config.game.foodHealCap ?? 0.3,
        healManaCost: config.game.healManaCost ?? 0.3,
        healBase: config.game.healBase ?? 0.3,
        prestigeLevel: config.game.prestigeLevel ?? 500,
        raceChangeDays: config.game.raceChangeDays ?? 30,
        hpRegenHours: config.game.hpRegenHours ?? 24,
        manaRegenHours: config.game.manaRegenHours ?? 1,
        chatPoints: config.game.chatPoints,
        chatCooldown: config.game.chatCooldown,
        chatPointsFullPerDay: config.game.chatPointsFullPerDay ?? 30,
        replyInChat: config.game.replyInChat,
        chatPointsMinChars: config.game.chatPointsMinChars ?? 3,
        chatPointsNoRepeats: config.game.chatPointsNoRepeats ?? true,
        chatPointsNewUserMinutes: config.game.chatPointsNewUserMinutes ?? 0,
        subChatMultiplier: config.game.subChatMultiplier ?? 2,
        emoteCommands: envEmotes(config.game.emoteCommands),
        adminUsers: config.adminUsers || [],
      },
      casino: {
        casinoEnabled: config.game.casinoEnabled ?? true,
        casinoMinBet: config.game.casinoMinBet ?? 10,
        casinoMaxBet: config.game.casinoMaxBet ?? 0,
        casinoCooldown: config.game.casinoCooldown ?? 5,
        plinkoMaxBalls: config.game.plinkoMaxBalls ?? 1000,
        plinkoDropMs: config.game.plinkoDropMs ?? 100,
        cardsEnabled: config.game.cardsEnabled ?? true,
        cardPackPriceMultiplier: config.game.cardPackPriceMultiplier ?? 1,
        cardBuyback: config.game.cardBuyback ?? 0.6,
        bankDailyLimit: config.game.bankDailyLimit ?? 25000,
        bankFullValue: config.game.bankFullValue ?? 5000,
        relicsEnabled: config.game.relicsEnabled ?? true,
        relicCasePriceMultiplier: config.game.relicCasePriceMultiplier ?? 1,
        relicBuyback: config.game.relicBuyback ?? 0.6,
      },
      events: {
        followPoints: config.game.followPoints ?? 100,
        followMessages: config.game.followMessages ?? true,
        followFloodPerMinute: config.game.followFloodPerMinute ?? 5,
        subPoints: config.game.subPoints ?? 500,
        giftPointsPerSub: config.game.giftPointsPerSub ?? 250,
        giftBoostMinutesPerSub: config.game.giftBoostMinutesPerSub ?? 5,
        giftBoostMultiplier: config.game.giftBoostMultiplier ?? 2,
        eventsOnlyWhenLive: config.game.eventsOnlyWhenLive ?? true,
        randomEventMinutes: config.game.randomEventMinutes ?? 15,
        raidEveryMinutes: config.game.raidEveryMinutes ?? 0,
        raidMinutes: config.game.raidMinutes ?? 10,
        raidRewardPoints: config.game.raidRewardPoints ?? 5000,
        raidHpPerChatter: config.game.raidHpPerChatter ?? 2,
        worldBossHpMultiplier: config.game.worldBossHpMultiplier ?? 300,
        worldBossDays: config.game.worldBossDays ?? 7,
        autoGoalTarget: config.game.autoGoalTarget ?? 0,
        redeemEnabled: config.game.redeemEnabled ?? true,
        redeemOnlyLive: config.game.redeemOnlyLive ?? true,
        projectsEnabled: config.game.projectsEnabled ?? true,
        duelsEnabled: config.game.duelsEnabled ?? true,
        coffeeSeedsPerGiftedSub: config.game.coffeeSeedsPerGiftedSub ?? 1,
        trailBrewCooldownMinutes: config.game.trailBrewCooldownMinutes ?? 60,
        housesEnabled: config.game.housesEnabled ?? true,
        townEnabled: config.game.townEnabled ?? true,
        townXpPerLevel: config.game.townXpPerLevel ?? 0.02,
        townGoalMultiplier: config.game.townGoalMultiplier ?? 1,
        shopsEnabled: config.game.shopsEnabled ?? true,
        heistsEnabled: config.game.heistsEnabled ?? true,
        heistMinTarget: config.game.heistMinTarget ?? 5000,
        heistStealPct: config.game.heistStealPct ?? 0.03,
        heistMaxSteal: config.game.heistMaxSteal ?? 25000,
        heistFencePct: config.game.heistFencePct ?? 0.2,
        heistFinePct: config.game.heistFinePct ?? 0.05,
        heistMaxFine: config.game.heistMaxFine ?? 10000,
        heistStealthBase: config.game.heistStealthBase ?? 0.45,
        heistStealthPerLevel: config.game.heistStealthPerLevel ?? 0.004,
        heistMugPct: config.game.heistMugPct ?? 0.5,
        heistGuardFightBonus: config.game.heistGuardFightBonus ?? 0.15,
        heistProtectMinutes: config.game.heistProtectMinutes ?? 60,
        heistJailMinutes: config.game.heistJailMinutes ?? 30,
        heistSameTargetHours: config.game.heistSameTargetHours ?? 6,
        heistDailyLoot: config.game.heistDailyLoot ?? 50000,
        heistGuardPct: config.game.heistGuardPct ?? 0.005,
        pickpocketEnabled: config.game.pickpocketEnabled ?? true,
        poachEnabled: config.game.poachEnabled ?? true,
        burglaryEnabled: config.game.burglaryEnabled ?? true,
        wantedEnabled: config.game.wantedEnabled ?? true,
        jailbreakEnabled: config.game.jailbreakEnabled ?? true,
        tipoffsEnabled: config.game.tipoffsEnabled ?? true,
        racketsEnabled: config.game.racketsEnabled ?? true,
        crimeMinTargetLevel: config.game.crimeMinTargetLevel ?? 10,
        crimeDailyLimit: config.game.crimeDailyLimit ?? 15,
        wantedMin: config.game.wantedMin ?? 500,
        bailPct: config.game.bailPct ?? 0.02,
        racketMaxPrice: config.game.racketMaxPrice ?? 5000,
        veilEnabled: config.game.veilEnabled ?? true,
        veilMinutes: config.game.veilMinutes ?? 15,
        veilBagSize: config.game.veilBagSize ?? 12,
        veilLootMultiplier: config.game.veilLootMultiplier ?? 1,
        veilPvpChance: config.game.veilPvpChance ?? 0.15,
        veilSamePairHours: config.game.veilSamePairHours ?? 24,
        veilActionSeconds: config.game.veilActionSeconds ?? 5,
        arenaEnabled: config.game.arenaEnabled ?? true,
        arenaFee: config.game.arenaFee ?? 100,
        arenaFightsPerDay: config.game.arenaFightsPerDay ?? 10,
        arenaBurnPct: config.game.arenaBurnPct ?? 0.1,
        guildWarsEnabled: config.game.guildWarsEnabled ?? true,
        guildWarXpBonus: config.game.guildWarXpBonus ?? 0.05,
        tradingEnabled: config.game.tradingEnabled ?? true,
        tradeMinHours: config.game.tradeMinHours ?? 24,
        tradeMinActions: config.game.tradeMinActions ?? 20,
        seasonDays: config.game.seasonDays ?? 30,
        tradeDailyPoints: config.game.tradeDailyPoints ?? 10000,
      },
      economy: { xpMultiplier: 1, pointsMultiplier: 1, sellMultiplier: 1, growMultiplier: 1, agilityRefillPerLevel: config.game.agilityRefillPerLevel ?? 0.001, agilityRefillMax: config.game.agilityRefillMax ?? 0.5, agilityShortcutChance: config.game.agilityShortcutChance ?? 0.05, stationXpBonus: config.game.stationXpBonus ?? 1.2, gatherBonusLevels: config.game.gatherBonusLevels ?? 50, plotsPerStamina: config.game.plotsPerStamina ?? 25, fireMealsBase: config.game.fireMealsBase ?? 10, fireMealsPerLevels: config.game.fireMealsPerLevels ?? 2, plotPriceGrowth: config.game.plotPriceGrowth ?? 1.12, priceSupplyScale: config.game.priceSupplyScale ?? 25000, priceRecoveryHours: config.game.priceRecoveryHours ?? 6, priceFloor: config.game.priceFloor ?? 0.35, petDropMultiplier: config.game.petDropMultiplier ?? 1, marketFee: config.game.marketFee ?? 0.05 },
      disabledCommands: [],
    };
    for (const [key, t] of Object.entries(TABLES)) {
      this.defaults[key] = t.rows().map((row) => ({
        ...(t.key ? { [t.key]: row[t.key] } : {}),
        ...Object.fromEntries(Object.keys(t.columns).map((c) => [c, row[c]])),
      }));
    }
    // The Agility refill cap went from 25% to 50% (high Agility halves the refill time). Economy
    // settings saved while the old default was in place still hold 0.25: move them up once.
    const saved = this.repo.getSetting('config_overrides');
    if (saved?.economy?.agilityRefillMax === 0.25 && !this.repo.getSetting('migrated:agility_cap')) {
      saved.economy.agilityRefillMax = 0.5;
      this.repo.setSetting('config_overrides', saved);
    }
    if (!this.repo.getSetting('migrated:agility_cap')) this.repo.setSetting('migrated:agility_cap', true);
    this.reload();
  }

  reload() {
    const o = this.repo.getSetting('config_overrides') || {};
    // Rods saved before tools were generalised used "snapChance" for what is now "failChance".
    if (Array.isArray(o.rods)) {
      o.rods = o.rods.map(({ snapChance, ...row }) => (snapChance !== undefined && row.failChance === undefined ? { ...row, failChance: snapChance } : row));
    }
    const d = this.defaults;
    // Saved tables are applied row by row, so adding rows later (e.g. a new shop item) keeps earlier edits.
    const table = (name) => {
      const saved = o[name];
      if (!Array.isArray(saved)) return d[name];
      const key = TABLES[name].key;
      if (key) {
        // Rows saved before keys existed are in the old order, which matched the defaults' first rows.
        const byKey = new Map(saved.map((row, i) => [row[key] ?? d[name][i]?.[key], row]));
        return d[name].map((row) => ({ ...row, ...(byKey.get(row[key]) || {}), [key]: row[key] }));
      }
      return saved.length <= d[name].length ? d[name].map((row, i) => ({ ...row, ...(saved[i] || {}) })) : d[name];
    };
    this.all = {
      general: { ...d.general, ...(o.general || {}) },
      economy: { ...d.economy, ...(o.economy || {}) },
      casino: { ...d.casino, ...(o.casino || {}) },
      events: { ...d.events, ...(o.events || {}) },
      disabledCommands: Array.isArray(o.disabledCommands) ? o.disabledCommands : d.disabledCommands,
      ...Object.fromEntries(Object.keys(TABLES).map((k) => [k, table(k)])),
    };
    this.overridden = Object.keys(o);
  }

  // Flat view the game engine reads on every command.
  get game() {
    return { ...this.all.general, ...this.all.economy, ...this.all.casino, ...this.all.events, disabledCommands: this.all.disabledCommands };
  }

  // Validate and save one section. Returns the new settings; throws SettingsError on bad input.
  update(section, value) {
    const o = this.repo.getSetting('config_overrides') || {};
    if (FIELDS[section]) {
      const next = {};
      for (const [key, spec] of Object.entries(FIELDS[section])) {
        next[key] = key in (value || {}) ? coerce(spec, value[key], spec.label) : this.all[section][key];
      }
      o[section] = next;
    } else if (section === 'disabledCommands') {
      if (!Array.isArray(value)) throw new SettingsError('disabledCommands must be a list');
      o.disabledCommands = value.map(String).filter((c) => COMMANDS.includes(c));
    } else if (TABLES[section]) {
      o[section] = this.validateTable(section, value);
    } else {
      throw new SettingsError(`unknown settings section "${section}"`);
    }
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
  }

  validateTable(section, rows) {
    const t = TABLES[section];
    const expected = this.defaults[section].length;
    if (!Array.isArray(rows) || rows.length !== expected) throw new SettingsError(`${t.label} needs exactly ${expected} rows`);
    const out = rows.map((row, i) =>
      Object.fromEntries(
        Object.entries(t.columns).map(([key, spec]) => [key, coerce(spec, row?.[key], `${t.label} tier ${i + 1} ${spec.label}`)])
      )
    );
    // Tiers must get strictly better/pricier as they go up.
    const ascending = t.ascending;
    for (let i = 1; ascending && i < out.length; i++) {
      if (out[i][ascending] <= out[i - 1][ascending]) {
        throw new SettingsError(`${t.label}: tier ${i + 1} ${t.columns[ascending].label.toLowerCase()} must be higher than tier ${i}`);
      }
    }
    if (t.tool && out[0].level !== 1) throw new SettingsError(`${t.label}: the first tier must be available at level 1`);
    if (t.key) return out.map((row, i) => ({ [t.key]: this.defaults[section][i][t.key], ...row }));
    return out;
  }

  // Puts a section back to a saved value (undefined/null = defaults). Used to undo admin changes.
  restoreSection(section, value) {
    const o = this.repo.getSetting('config_overrides') || {};
    if (value === undefined || value === null) delete o[section];
    else o[section] = value;
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
  }

  reset(section) {
    const o = this.repo.getSetting('config_overrides') || {};
    delete o[section];
    this.repo.setSetting('config_overrides', o);
    this.reload();
    this.emit('change', section);
    return this.all;
  }

  // Everything the admin page needs to render the settings form.
  describe() {
    return {
      values: this.all,
      defaults: this.defaults,
      overridden: this.overridden,
      fields: FIELDS,
      commands: COMMANDS,
      tables: Object.fromEntries(
        Object.entries(TABLES).map(([k, t]) => [
          k,
          { label: t.label, columns: t.columns, names: t.rows().map((r) => `${r.icon || ''} ${r.name || ''}`.trim()) },
        ])
      ),
      environment: {
        channel: this.config.kick.channel,
        baseUrl: this.config.baseUrl,
        baseUrlSource: this.config.baseUrlSource,
        dbPath: this.config.dbPath,
        kickClientId: this.config.kick.clientId ? `${this.config.kick.clientId.slice(0, 4)}…` : '(not set)',
        devMode: this.config.devMode,
      },
    };
  }
}

module.exports = { Settings, SettingsError, COMMANDS };
