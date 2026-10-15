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
src/worker/   simulation Web Worker: SimHost (testable logic), message protocol
src/ui/       React UI
src/i18n/     UI strings (en.json); always use t('key') for user-visible text
```

Key design decisions:

- **Landlab-style fields and components.** Per-cell data lives in `PlanetState.fields`: one typed array (`Float32Array` or `Int32Array`) per named field; add new fields to `FIELD_SPECS` in `src/sim/core/fields.ts` with type and unit. Processes implement `SimComponent` (`src/sim/core/component.ts`): they declare `inputs`/`outputs` fields and implement `runOneStep(state, dtYears, rng)`. `createSimulation` validates that every input is initialized or written by an earlier component, so component order matters: geosphere → atmosphere → biosphere → civilization → events.
- **Multiple time scales.** Slow components set `minIntervalYears`; the orchestrator skips them until enough time has passed and then passes the accumulated elapsed years as `dt`. Every component runs on the first step.
- **Grid.** Equirectangular lat/long grid, row-major (`y * width + x`), row 0 = north, wraps east-west, no wrap at the poles (neighbour = -1). Cells are not equal: east-west spacing (`rowDx`) and area (`rowCellArea`) shrink towards the poles, so use real distances/areas and `areaWeightedMean` for global statistics. `getTopology(grid)` gives cached 8-neighbour tables and distances. Resolution is a parameter (UI offers 128×64, 256×128 default, 512×256). Never hard-code grid dimensions. Per-cell constants tuned on the 128×64 reference grid must be scaled with `resolutionScale(grid)` or expressed in physical units (metres, m²) so behaviour does not change with resolution; verify by comparing 1 Gyr runs at two resolutions.
- **Determinism.** All randomness goes through `Rng` (`src/sim/core/rng.ts`), and its state is stored in `PlanetState.rngState`. The same seed must reproduce the same planet and history; don't use `Math.random()` inside `src/sim`.
- **Plain-data state.** `PlanetState` must stay serializable (typed arrays and plain objects, no class instances or closures), so it can be saved and moved into a Web Worker later.
- **Geosphere pipeline** (`src/sim/world.ts`): `generateTectonicPlanet` builds plates (noise-warped Voronoi with Euler-pole velocities), continental crust, boundary relief and the `upliftRate` field; each step then runs `plateDrift` → `tectonicUplift` → `flowRouting` (priority-flood depression filling + D8 + drainage area) → `streamPowerEroder` (implicit Braun–Willett / Landlab FastscapeEroder, n = 1) → `linearDiffuser` (finite-volume, land only, auto sub-stepping). Sea level is `SEA_LEVEL` = 0; ocean cells are flow outlets. Eroded material is removed, not deposited.
- **Plate drift** (`drift.ts`, `plates.ts`): each `Plate` stores its crust in its own reference raster (`plate.crust`, same grid as the planet) plus a cumulative `rotation` matrix. Each step the plates rotate and the planet fields (`plateId`, `elevation`, `crustType`) are re-composed by gathering from the rasters (plates are culled per cell by a bounding cap); before that, the previous step's field changes are written back as averaged deltas, because several planet cells can sample one reference cell. Crust created by hole filling never displaces another plate's crust, otherwise fill/consume cycles create runaway mountains. Never resample plate shapes from the planet grid — that is what made plates fragment in earlier attempts. Overlaps: continental beats oceanic, colliding continents thicken (spread over neighbours) and stall; gaps become ridge-depth ocean floor. Continental crust is kept near a target fraction by arc and shelf accretion. If you change fields that belong to crust, make sure the write-back carries them into the plates.
- **Climate** (`src/sim/models/atmosphere/`): `stellarEvolution` sets `globals.solarInput` from the planet age (faint young Sun; random planets start at 4.5 Gyr). `createClimate` is a 2D energy-balance model (Budyko–Sellers/North): steady state of Q(φ)(1−α) = A + B·T − F_greenhouse − D∇²T solved with conjugate gradients on a coarse 64×32 grid, interpolated to the fine grid with a lapse rate, with an ice–albedo feedback (snowball states persist via the stored `iceCover`/`albedo`). Greenhouse forcing comes from `globals.atmosphere` (CO₂, CH₄).
- **Carbon cycle** (`carbon.ts`): the silicate-weathering thermostat. Outgassing = volcanism × mantle heat (declines with age) × (hotspot share + plate-speed share); weathering grows with land runoff, temperature (≈9%/°C) and CO₂ and stops under ice. CO₂ is solved implicitly each step (bisection on log CO₂, temperatures extrapolated with a climate sensitivity) because the reservoir responds faster than a step. `createRandomWorld` spins the atmosphere up to balance before the first step. Expected behaviour: CO₂ falls as the star brightens, snowballs end when CO₂ builds up, and CO₂ runs out at ~6–7 Gyr, after which the planet overheats.
- **Surface albedo and life.** `createSurfaceAlbedo` sets the ice-free `surfaceAlbedo` field (ocean, land, daisies); the climate model mixes it with ice. Biosphere components change albedo through the fields this component reads.
- **Biomes** (`src/sim/models/biosphere/biomes.ts`, data in `src/sim/data/biomes.ts`): a Whittaker-style classification from annual temperature and precipitation, plus ice, alpine rock and river swamps. Biome data sets surface albedo and a weathering multiplier, so vegetation feeds back on climate and CO₂. Tune biome properties in the data table, not in the models.
- **Scenarios** (`src/sim/scenarios/`): `SCENARIOS` maps ids to world factories (`random` = `createRandomWorld`, `daisyworld`). Each `World` carries its own `yearsPerStep`. Daisyworld is land-only with no geology or carbon cycle and no ice–albedo feedback; daisies (Watson & Lovelock 1983) run many generations per step, relax towards the result and disperse to neighbours. The UI picks charts and the initial map layer per scenario (`SCENARIO_VIEW` in `App.tsx`).
- **History** (`src/sim/history.ts`): `recordHistory` samples global series each step into `PlanetState.history` (thinned past 2000 samples); frames carry it to the small-multiple uPlot charts (`src/ui/charts`). One measure per chart — no dual axes.
- **Tuning.** Erodibility and uplift are effective values for ~300 km cells, not field measurements, and are tuned as a pair: their ratio sets equilibrium mountain height, their magnitude sets how fast landscapes evolve. Check changes over ~1 Gyr of 1 Myr steps (land fraction, mean land elevation, peak height), not just one step.
- **Worker.** The simulation runs in a Web Worker (`src/worker/sim.worker.ts` → `SimHost`). The UI sends `WorkerRequest`s and receives `Frame`s: transferred copies of the fields in `RENDERED_FIELDS` plus stats. A field the map needs must be added to `RENDERED_FIELDS`.
- **Performance.** `simulation.timings` gives per-component milliseconds for the last step (shown as "Step: N ms" in the UI). Measure before optimizing. Approximate step costs: 128×64 ≈ 18 ms, 256×128 ≈ 50 ms, 512×256 ≈ 200 ms; `plateDrift` dominates.

## Roadmap

M0 scaffold (done) → M1 geosphere (done: plate-based terrain, drift, uplift, flow routing, fluvial erosion, diffusion; deliberately not doing more Landlab-style physics such as flexure or sediment transport until gameplay needs it) → M2 climate (done: energy balance, ice–albedo, precipitation, carbon cycle, history charts, Daisyworld) → M3 biomes (done) → M4 life classes and evolution → M5 civilization → M6 player tools, Ω energy budget, scenarios, save/load.
