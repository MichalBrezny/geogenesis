# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

A browser-based planet simulation game in the style of SimEarth (Maxis, 1990): geosphere, atmosphere, biosphere and civilization models coupled by Gaia-style feedback loops. Stack: TypeScript (strict), Vite, React for UI, Canvas 2D for the map, Vitest.

All code, identifiers, comments, commit messages and UI strings are in **English** (international audience). The project owner may write in Czech.

## Commands

```sh
npm run dev          # dev server at http://localhost:5173
npm test             # all tests once (vitest run)
npx vitest run src/sim/core/grid.test.ts   # single test file
npx vitest run -t "wraps east-west"        # single test by name
npm run test:watch
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run format       # prettier --write
npm run build        # typecheck + production build
```

## Architecture

```
src/sim/      pure simulation core (no DOM, React or render imports — enforced by ESLint)
  core/       grid, fields, planet state, seeded RNG, component interface
  models/     geosphere/, atmosphere/ (later biosphere/, civilization/)
  simulation.ts  orchestrator; world.ts  assembles planet + component pipeline
src/render/   draws planet fields to a canvas (palettes, layers)
src/ui/       React UI
src/i18n/     UI strings (en.json); always use t('key') for user-visible text
```

Key design decisions:

- **Landlab-style fields and components.** Per-cell data lives in `PlanetState.fields`: one `Float32Array` per named field (`src/sim/core/fields.ts`, add new fields to `FIELD_NAMES` with units). Processes implement `SimComponent` (`src/sim/core/component.ts`): they declare `inputs`/`outputs` fields and implement `runOneStep(state, dtYears, rng)`. `createSimulation` validates that every input is initialized or written by an earlier component, so component order matters: geosphere → atmosphere → biosphere → civilization → events.
- **Multiple time scales.** Slow components set `minIntervalYears`; the orchestrator skips them until enough time has passed and then passes the accumulated elapsed years as `dt`. Every component runs on the first step.
- **Grid.** Equirectangular lat/long grid, row-major (`y * width + x`), row 0 = north, wraps east-west, no wrap at the poles (neighbour = -1). Cell area shrinks with cos(latitude): use `areaWeightedMean` for global statistics. Default 128×64, but resolution is a parameter and will be refined later. Never hard-code grid dimensions.
- **Determinism.** All randomness goes through `Rng` (`src/sim/core/rng.ts`), and its state is stored in `PlanetState.rngState`. The same seed must reproduce the same planet and history; don't use `Math.random()` inside `src/sim`.
- **Plain-data state.** `PlanetState` must stay serializable (typed arrays and plain objects, no class instances or closures), so it can be saved and moved into a Web Worker later.
- The UI currently runs the simulation on the main thread (`src/ui/App.tsx`); moving it to a Web Worker is planned.

## Roadmap

M0 scaffold (done) → M1 geosphere (terrain generation, tectonics, erosion ported from Landlab algorithms: D8 flow routing, stream-power erosion, hillslope diffusion) → M2 climate (energy balance, albedo, greenhouse gases) and Daisyworld → M3 biomes → M4 life classes and evolution → M5 civilization → M6 player tools, Ω energy budget, scenarios, save/load.
