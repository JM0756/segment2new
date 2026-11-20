// One unlock track per archetype, shared by its saved settings.
const Progression = {
  enter(unlocked, requested=1) {
    return Math.min(requested, unlocked);
  },
  canRemix(level, unlocked) {
    return level > 0 && level <= unlocked;
  },
  complete(unlocked, level, result) {
    if (level > unlocked || !result.passed) return unlocked;
    if (level === 0) return Math.max(unlocked, 1);
    if (level === 1 && result.accuracy >= 80 && result.stars === 3) return 2;
    return unlocked;
  }
};
if (typeof module !== 'undefined') module.exports = Progression;
