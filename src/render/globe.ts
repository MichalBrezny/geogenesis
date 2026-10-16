/**
 * Orthographic globe view of the equirectangular planet grid. A lookup table maps
 * every globe pixel to a grid cell, so redrawing a frame is only a gather; the
 * table is rebuilt when the view turns or the grid changes.
 */

/** Where the globe faces: the longitude and latitude at the centre of the disc, degrees. */
export interface GlobeView {
  longitude: number;
  latitude: number;
}

export interface GlobeLookup {
  size: number;
  /** Grid cell per pixel (row-major, size × size), −1 outside the disc. */
  cells: Int32Array;
  /** Brightness per pixel: dims the limb so the disc reads as a sphere. */
  shade: Float32Array;
}

const DEG = Math.PI / 180;
/** Brightness at the limb relative to the centre of the disc. */
const LIMB_BRIGHTNESS = 0.45;

/** Grid cell under a point of the disc given in [-1, 1] (x right, y up), or −1 off the planet. */
export function globeCell(
  u: number,
  v: number,
  view: GlobeView,
  width: number,
  height: number,
): number {
  const r2 = u * u + v * v;
  if (r2 > 1) return -1;
  const z = Math.sqrt(1 - r2);
  const lat0 = view.latitude * DEG;
  const sinLat0 = Math.sin(lat0);
  const cosLat0 = Math.cos(lat0);
  // Inverse orthographic projection.
  const lat = Math.asin(Math.max(-1, Math.min(1, z * sinLat0 + v * cosLat0)));
  const lon = view.longitude * DEG + Math.atan2(u, z * cosLat0 - v * sinLat0);
  const turns = lon / (2 * Math.PI);
  const x = Math.floor((turns - Math.floor(turns)) * width) % width;
  const y = Math.min(height - 1, Math.max(0, Math.floor((0.5 - lat / Math.PI) * height)));
  return y * width + x;
}

/** Builds the pixel-to-cell table for a square globe image of `size` pixels. */
export function buildGlobeLookup(
  size: number,
  view: GlobeView,
  width: number,
  height: number,
): GlobeLookup {
  const cells = new Int32Array(size * size);
  const shade = new Float32Array(size * size);
  for (let py = 0; py < size; py++) {
    const v = 1 - (2 * (py + 0.5)) / size;
    for (let px = 0; px < size; px++) {
      const u = (2 * (px + 0.5)) / size - 1;
      const p = py * size + px;
      cells[p] = globeCell(u, v, view, width, height);
      const r2 = u * u + v * v;
      shade[p] = r2 > 1 ? 0 : LIMB_BRIGHTNESS + (1 - LIMB_BRIGHTNESS) * Math.sqrt(1 - r2);
    }
  }
  return { size, cells, shade };
}

/** Projects grid pixels (RGBA, 1 pixel per cell) onto the globe; outside the disc is transparent. */
export function projectGlobe(
  gridPixels: Uint8ClampedArray,
  lookup: GlobeLookup,
): Uint8ClampedArray<ArrayBuffer> {
  const { cells, shade } = lookup;
  const out = new Uint8ClampedArray(cells.length * 4);
  for (let p = 0; p < cells.length; p++) {
    const cell = cells[p]!;
    if (cell < 0) continue;
    const s = shade[p]!;
    const src = cell * 4;
    const dst = p * 4;
    out[dst] = gridPixels[src]! * s;
    out[dst + 1] = gridPixels[src + 1]! * s;
    out[dst + 2] = gridPixels[src + 2]! * s;
    out[dst + 3] = 255;
  }
  return out;
}

/** Turns the view by a drag of (dx, dy) disc radii; latitude is clamped so the poles stay upright. */
export function dragGlobe(view: GlobeView, dx: number, dy: number): GlobeView {
  const longitude = (((view.longitude - dx * 90) % 360) + 360) % 360;
  const latitude = Math.max(-90, Math.min(90, view.latitude + dy * 90));
  return { longitude, latitude };
}
