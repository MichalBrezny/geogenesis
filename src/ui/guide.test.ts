import en from '../i18n/en.json';
import { describe, expect, it } from 'vitest';
import {
  GUIDE_PAGE_IDS,
  TOUR_ANCHORS,
  TOUR_STEPS,
  rememberTourComplete,
  shouldStartTour,
} from './guide';

describe('onboarding guide registry', () => {
  it('references rendered tour anchors without duplicates', () => {
    const rendered = new Set(Object.values(TOUR_ANCHORS));
    expect(TOUR_STEPS.every((step) => rendered.has(step.anchor))).toBe(true);
    expect(new Set(TOUR_STEPS.map((step) => step.anchor)).size).toBe(TOUR_STEPS.length);
  });

  it('has every translated guide page field', () => {
    for (const id of GUIDE_PAGE_IDS) {
      for (const part of ['title', 'summary', 'loop', 'controls', 'views']) {
        expect(en).toHaveProperty(`guide.${id}.${part}`);
      }
    }
  });

  it('falls back safely when localStorage is unavailable', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(shouldStartTour(throwing)).toBe(true);
    expect(rememberTourComplete(throwing)).toBe(false);
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
    };
    expect(shouldStartTour(storage)).toBe(true);
    expect(rememberTourComplete(storage)).toBe(true);
    expect(shouldStartTour(storage)).toBe(false);
  });
});
