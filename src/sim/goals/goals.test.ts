import { describe, expect, it } from 'vitest';
import { createPlanet, type PlanetState } from '../core/planet';
import { clampGoalControls, createGoal, GOALS, goalTracker, type GoalState } from './goals';

function thawedPlanet(): PlanetState {
  const state = createPlanet({ width: 8, height: 4 });
  state.globals.year = 4e9;
  state.globals.iceFraction = 0.1;
  state.globals.meanTemperature = 6;
  return state;
}

function runSnowballSteps(steps: number[]): GoalState {
  const state = thawedPlanet();
  const goal = createGoal('snowball', state.globals.year);
  GOALS.snowball.evaluate(state, goal, 0);
  for (const dt of steps) {
    if (goal.status !== 'active') break;
    GOALS.snowball.evaluate(state, goal, dt);
    state.globals.year += dt;
  }
  return goal;
}

describe('goal evaluators', () => {
  it('measures a sustained thaw in years, independently of step length', () => {
    const fine = runSnowballSteps([1e6, 1e6, 1e6, 1e6, 1e6]);
    const coarse = runSnowballSteps([2.5e6, 2.5e6]);
    expect(fine.status).toBe('won');
    expect(coarse.status).toBe('won');
    expect(fine.outcomeYear).toBe(4.005e9);
    expect(coarse.outcomeYear).toBe(fine.outcomeYear);
  });

  it('resets the sustained timer when either thaw condition fails', () => {
    const state = thawedPlanet();
    const goal = createGoal('snowball', state.globals.year);
    GOALS.snowball.evaluate(state, goal, 0);
    GOALS.snowball.evaluate(state, goal, 3e6);
    state.globals.year += 3e6;
    state.globals.iceFraction = 0.2;
    GOALS.snowball.evaluate(state, goal, 1e6);
    expect(goal.heldSince).toBeNull();
    expect(goal.status).toBe('active');
  });

  it('records exactly one frozen win transition and reason', () => {
    const state = thawedPlanet();
    state.goal = createGoal('snowball', state.globals.year - 5e6);
    state.goal.heldSince = state.globals.year - 5e6;
    goalTracker.runOneStep(state, 0, { next: () => 0, state: 0 } as never);
    goalTracker.runOneStep(state, 1e6, { next: () => 0, state: 0 } as never);
    expect(state.goal.status).toBe('won');
    expect(state.goal.outcomeReason).toBe('snowballThawed');
    expect(state.events.filter((event) => event.key === 'goalWon')).toHaveLength(1);
    expect(state.events.at(-1)?.subject).toBe('snowballThawed');
  });

  it('loses cradle after its absolute two-billion-year deadline', () => {
    const state = createPlanet({ width: 8, height: 4 });
    state.globals.year = 6e9;
    const goal = createGoal('cradle', 4e9);
    GOALS.cradle.evaluate(state, goal, 0);
    expect(goal.status).toBe('lost');
    expect(goal.outcomeReason).toBe('timeExpired');
  });

  it('wins cradle when a sentience event is present', () => {
    const state = createPlanet({ width: 8, height: 4 });
    state.globals.year = 4.2e9;
    const goal = createGoal('cradle', 4e9);
    state.events.push({ year: state.globals.year, key: 'sentience', subject: 'mammals' });
    GOALS.cradle.evaluate(state, goal, 0);
    expect(goal.status).toBe('won');
    expect(goal.outcomeReason).toBe('sentience');
  });
});

describe('goal control limits', () => {
  it('clamps restricted controls while retaining unrestricted values', () => {
    const state = createPlanet({ width: 8, height: 4 });
    state.goal = createGoal('brighteningSun', 6.6e9);
    expect(clampGoalControls(state, { solarFactor: 0.1, cloudAlbedo: 5, driftSpeed: 2 })).toEqual({
      solarFactor: 0.92,
      cloudAlbedo: 1.3,
      driftSpeed: 2,
    });
  });

  it('does not clamp sandbox controls', () => {
    const state = createPlanet({ width: 8, height: 4 });
    expect(clampGoalControls(state, { solarFactor: 0.1 })).toEqual({ solarFactor: 0.1 });
  });
});
