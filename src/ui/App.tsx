import { useEffect, useRef, useState } from 'react';
import { t } from '../i18n/i18n';
import { renderLayer, type MapLayer } from '../render/mapRenderer';
import { areaWeightedMean } from '../sim/core/grid';
import { createRandomWorld, type World } from '../sim/world';

/** Simulated years per step. Will be driven by the selected time scale later. */
const YEARS_PER_STEP = 1_000_000;
const STEP_INTERVAL_MS = 200;
const LAYERS: readonly MapLayer[] = ['elevation', 'airTemperature'];

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 32);
}

export function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [world, setWorld] = useState<World>(() => createRandomWorld({ seed: randomSeed() }));
  const [layer, setLayer] = useState<MapLayer>('elevation');
  const [running, setRunning] = useState(false);
  // Simulation state is mutated in place; this counter triggers re-renders.
  const [revision, setRevision] = useState(0);

  const step = () => {
    world.simulation.step(world.planet, YEARS_PER_STEP);
    setRevision((r) => r + 1);
  };

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      world.simulation.step(world.planet, YEARS_PER_STEP);
      setRevision((r) => r + 1);
    }, STEP_INTERVAL_MS);
    return () => clearInterval(id);
  }, [running, world]);

  useEffect(() => {
    if (canvasRef.current) renderLayer(canvasRef.current, world.planet, layer);
  }, [world, layer, revision]);

  const { planet } = world;
  const meanTemperature = areaWeightedMean(planet.grid, planet.fields.airTemperature);

  return (
    <main className="app">
      <header className="toolbar">
        <h1>{t('app.title')}</h1>
        <button onClick={() => setRunning(!running)}>
          {running ? t('controls.pause') : t('controls.play')}
        </button>
        <button onClick={step} disabled={running}>
          {t('controls.step')}
        </button>
        <button onClick={() => setWorld(createRandomWorld({ seed: randomSeed() }))}>
          {t('controls.newPlanet')}
        </button>
        <label>
          {t('layer.label')}{' '}
          <select value={layer} onChange={(e) => setLayer(e.target.value as MapLayer)}>
            {LAYERS.map((l) => (
              <option key={l} value={l}>
                {t(`layer.${l}`)}
              </option>
            ))}
          </select>
        </label>
        <span>{t('time.year', { year: planet.globals.year.toLocaleString('en') })}</span>
        <span>{t('stats.meanTemperature', { value: meanTemperature.toFixed(1) })}</span>
      </header>
      <canvas ref={canvasRef} className="map" />
    </main>
  );
}
