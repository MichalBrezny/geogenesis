import type { SimComponent } from '../../core/component';

/** Temperature drop with altitude, °C per metre (standard atmosphere). */
const LAPSE_RATE = 0.0065;

/**
 * Placeholder climate: equilibrium surface air temperature from latitude,
 * solar input and altitude. Will be replaced by an energy-balance model
 * (albedo, greenhouse gases, heat transport) in milestone M2.
 */
export const surfaceTemperature: SimComponent = {
  name: 'surfaceTemperature',
  inputs: ['elevation'],
  outputs: ['airTemperature'],
  runOneStep(state) {
    const { grid, fields, globals } = state;
    const { elevation, airTemperature } = fields;
    // Crude scaling: temperature offset roughly follows the 4th root of solar input.
    const solarOffset = (Math.pow(globals.solarInput, 0.25) - 1) * 288;
    for (let y = 0; y < grid.height; y++) {
      const lat = (grid.rowLatitude[y]! * Math.PI) / 180;
      const seaLevelTemp = -15 + 42 * Math.cos(lat) ** 2 + solarOffset;
      const row = y * grid.width;
      for (let x = 0; x < grid.width; x++) {
        const i = row + x;
        airTemperature[i] = seaLevelTemp - Math.max(0, elevation[i]!) * LAPSE_RATE;
      }
    }
  },
};
