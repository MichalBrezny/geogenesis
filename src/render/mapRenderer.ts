import type { FieldName } from '../sim/core/fields';
import type { PlanetState } from '../sim/core/planet';
import { elevationPalette, temperaturePalette, type Rgb } from './palettes';

export type MapLayer = Extract<FieldName, 'elevation' | 'airTemperature'>;

const layerPalettes: Record<MapLayer, (value: number) => Rgb> = {
  elevation: elevationPalette,
  airTemperature: temperaturePalette,
};

/**
 * Draws one field at native grid resolution (1 pixel per cell) into the canvas.
 * The canvas is scaled up with CSS (`image-rendering: pixelated`).
 */
export function renderLayer(canvas: HTMLCanvasElement, state: PlanetState, layer: MapLayer): void {
  const { width, height, cellCount } = state.grid;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const image = ctx.createImageData(width, height);
  const values = state.fields[layer];
  const palette = layerPalettes[layer];
  for (let i = 0; i < cellCount; i++) {
    const [r, g, b] = palette(values[i]!);
    const p = i * 4;
    image.data[p] = r;
    image.data[p + 1] = g;
    image.data[p + 2] = b;
    image.data[p + 3] = 255;
  }
  ctx.putImageData(image, 0, 0);
}
