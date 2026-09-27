// Experience curve. Early levels are quick (level 2 after one catch), late levels are a long-term grind.
//   xpForLevel(2)  = 10      xpForLevel(10) = 1,565
//   xpForLevel(50) = 77,170  xpForLevel(99) = 380,031
const MAX_LEVEL = 99;
const CHARACTER_MAX_LEVEL = 120;

const curve = (level) => Math.floor(10 * Math.pow(level - 1, 2.3));

// Precompute the table once; index = level.
const XP_TABLE = [0, 0];
for (let l = 2; l <= CHARACTER_MAX_LEVEL + 1; l++) XP_TABLE[l] = curve(l);

function xpForLevel(level) {
  if (level <= 1) return 0;
  return XP_TABLE[Math.min(level, CHARACTER_MAX_LEVEL + 1)];
}

function levelForXp(xp, max = MAX_LEVEL) {
  let level = 1;
  while (level < max && xp >= XP_TABLE[level + 1]) level++;
  return level;
}

// Progress info used by the website and !stats.
function progress(xp, max = MAX_LEVEL) {
  const level = levelForXp(xp, max);
  if (level >= max) {
    return { level, xp, currentLevelXp: xpForLevel(level), nextLevelXp: null, percent: 100 };
  }
  const currentLevelXp = xpForLevel(level);
  const nextLevelXp = xpForLevel(level + 1);
  const percent = Math.floor(((xp - currentLevelXp) / (nextLevelXp - currentLevelXp)) * 100);
  return { level, xp, currentLevelXp, nextLevelXp, percent };
}

// Character level: driven by the average XP across all skills, so every skill contributes
// and training a balanced character is rewarded. Goes up to 120.
function characterProgress(totalXp, skillCount) {
  const avg = skillCount > 0 ? totalXp / skillCount : 0;
  // Skill XP keeps accumulating past 99, so levels 100-120 are a prestige band for maxed players.
  return progress(avg, CHARACTER_MAX_LEVEL);
}

module.exports = { MAX_LEVEL, CHARACTER_MAX_LEVEL, xpForLevel, levelForXp, progress, characterProgress };
