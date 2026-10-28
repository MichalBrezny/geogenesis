import type { MessageKey } from '../i18n/i18n';
import { LIFE_CLASSES } from '../sim/data/lifeClasses';
import type { Frame } from '../worker/protocol';

const plants = LIFE_CLASSES.findIndex((lifeClass) => lifeClass.key === 'plants');

/** One actionable sentence, chosen only from the current frame's diagnostics. */
export function currentTaskKey(frame: Frame): MessageKey {
  if (frame.runawayMargin < 20) return 'currentTask.runaway';
  if (frame.iceFraction > 0.8) return 'currentTask.snowball';
  if (frame.life.cover.every((cover) => cover <= 0)) return 'currentTask.life';
  if (plants >= 0 && frame.life.cover[plants]! > 0 && frame.co2 < 150)
    return 'currentTask.plantCo2';
  if (frame.era === 'evolution' && frame.o2Pressure < 0.04) return 'currentTask.oxygen';
  if (frame.era === 'technology' && frame.pollution > 0.55) return 'currentTask.pollution';
  if (frame.era === 'technology' && frame.fossilCarbon < 1_500) return 'currentTask.fossilLow';
  switch (frame.era) {
    case 'geological':
      return 'currentTask.geological';
    case 'evolution':
      return 'currentTask.evolution';
    case 'civilization':
      return 'currentTask.civilization';
    case 'technology':
      return 'currentTask.technology';
    default:
      return 'currentTask.observe';
  }
}
