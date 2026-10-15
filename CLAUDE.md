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

- **Landlab-style fields and components.** Per-cell data lives in `PlanetState.fields`: one typed array (`Float32Array` or `Int32Array`) per named field; add new fields to `FIELD_SPECS` in `src/sim/core/fields.ts` with type and unit. Processes implement `SimComponent` (`src/sim/core/component.ts`): they declare `inputs`/`outputs` fields and implement `runOneStep(state, dtYears, rng)`. `createSimulation` validates that every input is initialized or written by an earlier component, so component order matters: geosphere → atmosphere → biosphere → civilization → events.
- **Multiple time scales.** Slow components set `minIntervalYears`; the orchestrator skips them until enough time has passed and then passes the accumulated elapsed years as `dt`. Every component runs on the first step.
- **Grid.** Equirectangular lat/long grid, row-major (`y * width + x`), row 0 = north, wraps east-west, no wrap at the poles (neighbour = -1). Cells are not equal: east-west spacing (`rowDx`) and area (`rowCellArea`) shrink towards the poles, so use real distances/areas and `areaWeightedMean` for global statistics. `getTopology(grid)` gives cached 8-neighbour tables and distances. Default 128×64, but resolution is a parameter and will be refined later. Never hard-code grid dimensions.
- **Determinism.** All randomness goes through `Rng` (`src/sim/core/rng.ts`), and its state is stored in `PlanetState.rngState`. The same seed must reproduce the same planet and history; don't use `Math.random()` inside `src/sim`.
- **Plain-data state.** `PlanetState` must stay serializable (typed arrays and plain objects, no class instances or closures), so it can be saved and moved into a Web Worker later.
- **Geosphere pipeline** (`src/sim/world.ts`): `generateTectonicPlanet` builds plates (noise-warped Voronoi with Euler-pole velocities), continental crust, boundary relief and the `upliftRate` field; each step then runs `plateDrift` → `tectonicUplift` → `flowRouting` (priority-flood depression filling + D8 + drainage area) → `streamPowerEroder` (implicit Braun–Willett / Landlab FastscapeEroder, n = 1) → `linearDiffuser` (finite-volume, land only, auto sub-stepping). Sea level is `SEA_LEVEL` = 0; ocean cells are flow outlets. Eroded material is removed, not deposited.
- **Plate drift** (`drift.ts`, `plates.ts`): each `Plate` stores its crust in its own reference raster (`plate.crust`, same grid as the planet) plus a cumulative `rotation` matrix. Each step the plates rotate and the planet fields (`plateId`, `elevation`, `crustType`) are re-composed by gathering from the rasters; before that, the previous step's field changes are written back. Never resample plate shapes from the planet grid — that is what made plates fragment in earlier attempts. Overlaps: continental beats oceanic, colliding continents thicken (spread over neighbours) and stall; gaps become ridge-depth ocean floor. Continental crust is kept near a target fraction by arc and shelf accretion. If you change fields that belong to crust, make sure the write-back carries them into the plates.
- **Tuning.** Erodibility and uplift are effective values for ~300 km cells, not field measurements, and are tuned as a pair: their ratio sets equilibrium mountain height, their magnitude sets how fast landscapes evolve. Check changes over ~1 Gyr of 1 Myr steps (land fraction, mean land elevation, peak height), not just one step.
- The UI currently runs the simulation on the main thread (`src/ui/App.tsx`); moving it to a Web Worker is planned.

## Roadmap

M0 scaffold (done) → M1 geosphere (done: plate-based terrain, drift, uplift, flow routing, fluvial erosion, diffusion; deliberately not doing more Landlab-style physics such as flexure or sediment transport until gameplay needs it) → M2 climate (energy balance, albedo, greenhouse gases) and Daisyworld → M3 biomes → M4 life classes and evolution → M5 civilization → M6 player tools, Ω energy budget, scenarios, save/load.
