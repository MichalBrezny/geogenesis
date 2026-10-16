# Sim Earth

A browser-based planet simulation in the spirit of **SimEarth** (Maxis, 1990). Watch a planet
evolve over billions of years: plates drift and build mountains, rivers carve valleys, the climate
swings between hothouse and snowball, life evolves from microbes to sentient species, and a
civilization may rise, wreck its world or leave it for the stars. You can watch, or step in with
tools that reshape the land, the air and the living world.

The models are simplified but grounded in real Earth-system science: an energy-balance climate, the
silicate-weathering carbon thermostat, Whittaker biomes, Daisyworld, Landlab-style erosion. They
are coupled by Gaia-style feedbacks, so life changes the climate that shapes life.

> This is a fan project. It is not affiliated with, endorsed by or derived from the code of Maxis or
> Electronic Arts. "SimEarth" is a trademark of its respective owner.

## Features

- **Geosphere**: tectonic plates with continental drift, collisions, subduction arcs and mid-ocean
  ridges; flow routing, fluvial erosion (stream power) and hillslope diffusion.
- **Atmosphere and climate**: a faint young Sun that brightens with age, a 2D energy-balance
  model with ice–albedo feedback (snowball Earths), precipitation, and a carbon cycle in which
  volcanic outgassing and rock weathering keep CO₂ in balance.
- **Biosphere**: biomes classified from climate, 15 life classes from prokaryotes to mammals and
  cetaceans that spread, compete and evolve, oxygen from photosynthesis (with a Great Oxidation
  Event) and methane from microbes.
- **Civilization**: sentience, seven tech ages from the Stone Age to Nanotech, cities, farming,
  industrial CO₂, plagues, nuclear wars, and Exodus.
- **Player tools** paid for with Ω energy: raise and lower land, volcanoes, meteors, placing life,
  monoliths, and adding or removing CO₂. Model controls for sun brightness, volcanism, drift,
  erosion and mutation rate.
- **Scenarios**: random planet, Daisyworld (Watson & Lovelock 1983) and Aquarium (a water world).
- **Views**: map layers (terrain and rivers, plates, temperature, precipitation, biomes, life,
  civilization, daisies) on a flat map or an optional rotating globe; a cell inspector; history
  charts; an event log.
- **Save and load**: the whole planet in a compact binary file; the same seed always replays the
  same history.

## Play

Hosted on GitHub Pages once the repository is published (see [Deployment](#deployment)).

To run it locally you need [Node.js](https://nodejs.org/) 22 or newer:

```sh
npm install
npm run dev        # http://localhost:5173
```

### How to play

1. Press **Play**. A random planet starts 4 billion years old, with only simple microbes.
2. Switch the **map layer** to follow the climate, biomes or life, and the **view** to the globe
   if you like (drag to turn it). Hover over the map to inspect a cell.
3. Pick a **tool** and click the map to use it. Tools cost Ω energy, which builds up over time.
   Turn on experimental mode for unlimited energy.
4. Use the **model controls** to change how bright the sun is, how active the planet is, or how
   fast life mutates.
5. Watch the charts and the event log. Complex life takes about a billion years; once a species
   becomes sentient, time slows down to centuries and then years per step.

## Development

```sh
npm test             # unit tests (Vitest)
npm run typecheck    # TypeScript, strict
npm run lint         # ESLint
npm run format       # Prettier
npm run build        # typecheck + production build into dist/
```

Stack: TypeScript, Vite, React for the UI, Canvas 2D for the map, uPlot for charts, Vitest.

### Architecture

```
src/sim/      pure simulation core (no DOM or React, runs in a Web Worker)
  core/       grid, fields, planet state, seeded RNG, component interface
  models/     geosphere/, atmosphere/, biosphere/, civilization/
  data/       tunable tables: biomes, life classes, tech ages
  scenarios/  world factories
  tools/      player tools
src/render/   map layers and the globe projection
src/worker/   simulation Web Worker and its message protocol
src/ui/       React UI and charts
src/i18n/     UI strings
```

- **Fields and components** (after [Landlab](https://landlab.github.io/)): per-cell data lives in
  named typed arrays, and each process is a component that declares the fields it reads and
  writes. The orchestrator checks the order and runs slow components less often (geology every
  100 kyr, evolution every 10 kyr), so a step can be 1 million years or 5 years.
- **Grid**: an equirectangular latitude–longitude grid (128×64 to 512×256) that wraps east–west.
  It uses real cell areas and distances, so the results do not depend on the resolution.
- **Determinism**: all randomness comes from a seeded generator stored in the planet state; the
  state is plain data, so it can be saved, loaded and sent to the worker.

[`CLAUDE.md`](CLAUDE.md) describes each model and the design decisions in more detail.

## Milestones

| Milestone           | Content                                                                                                                            | Status         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| **M0** Scaffold     | Vite + React + TypeScript, grid and field model, component pipeline, seeded RNG, tests                                             | ✅ Done        |
| **M1** Geosphere    | Plate-based terrain, continental drift, tectonic uplift, flow routing, stream-power erosion, diffusion; simulation in a Web Worker | ✅ Done        |
| **M2** Climate      | Stellar evolution, energy-balance climate with ice–albedo feedback, precipitation, carbon cycle, history charts, Daisyworld        | ✅ Done        |
| **M3** Biomes       | Whittaker biome classification; biomes feed back on albedo and weathering; map legends                                             | ✅ Done        |
| **M4** Life         | 15 life classes, spreading and evolution, oxygen and methane, Great Oxidation Event                                                | ✅ Done        |
| **M5** Civilization | Sentience, tech ages, settlements, emissions, plagues, nuclear war, Exodus; variable time step; event log                          | ✅ Done        |
| **M6** Player       | Tools with the Ω energy budget, model controls, save and load, Aquarium scenario, cell inspector, speed setting                    | ✅ Done        |
| **M7** Presentation | Optional globe view, CI, GitHub Pages deployment, README                                                                           | 🚧 In progress |

### Ideas for later

- Random natural disasters (earthquakes, storms, meteor showers) that can be switched on or off.
- More scenarios with goals, such as terraforming or guiding a species to sentience.
- A short in-game guide to the models and their feedbacks.
- Mars and Venus, which need surface water and atmospheric pressure in the model first.

### Known limitations

- Mean land elevation swings with tectonic history.
- Finer grids show many small islands and ragged coasts.
- The latitude–longitude grid distorts plates near the poles.

## Deployment

The `Deploy to GitHub Pages` workflow (`.github/workflows/pages.yml`) builds and publishes the game
on every push to `main`. To turn it on, go to **Settings → Pages** in the repository and set
**Source** to **GitHub Actions**. The `CI` workflow runs the type check, lint and tests on every
push and pull request.

## References

- Watson, A. J., & Lovelock, J. E. (1983). Biological homeostasis of the global environment: the
  parable of Daisyworld. _Tellus B_, 35(4), 284–289.
- North, G. R., Cahalan, R. F., & Coakley, J. A. (1981). Energy balance climate models. _Reviews of
  Geophysics_, 19(1), 91–121.
- Walker, J. C. G., Hays, P. B., & Kasting, J. F. (1981). A negative feedback mechanism for the
  long-term stabilization of Earth's surface temperature. _Journal of Geophysical Research_,
  86(C10), 9776–9782.
- Braun, J., & Willett, S. D. (2013). A very efficient O(n), implicit and parallel method to solve
  the stream power equation governing fluvial incision and landscape evolution. _Geomorphology_,
  180–181, 170–179.
- Hobley, D. E. J., et al. (2017). Creative computing with Landlab. _Earth Surface Dynamics_, 5,
  21–46.
- Whittaker, R. H. (1975). _Communities and Ecosystems_ (2nd ed.). Macmillan.
