import type { Grid } from '../../core/grid';
import {
  MARS_TOPOGRAPHY_BASE64,
  MARS_TOPOGRAPHY_HEIGHT,
  MARS_TOPOGRAPHY_WIDTH,
} from './marsTopography';
import {
  VENUS_TOPOGRAPHY_BASE64,
  VENUS_TOPOGRAPHY_HEIGHT,
  VENUS_TOPOGRAPHY_WIDTH,
} from './venusTopography';

export type TopographyName = 'mars' | 'venus';

interface TopographySource {
  width: number;
  height: number;
  base64: string;
}

interface Overlap {
  index: number;
  weight: number;
}

const SOURCES: Readonly<Record<TopographyName, TopographySource>> = {
  mars: {
    width: MARS_TOPOGRAPHY_WIDTH,
    height: MARS_TOPOGRAPHY_HEIGHT,
    base64: MARS_TOPOGRAPHY_BASE64,
  },
  venus: {
    width: VENUS_TOPOGRAPHY_WIDTH,
    height: VENUS_TOPOGRAPHY_HEIGHT,
    base64: VENUS_TOPOGRAPHY_BASE64,
  },
};

const decoded = new Map<TopographyName, Int16Array>();

/** Decodes a source raster once; the returned array must be treated as read-only. */
function sourceElevation(name: TopographyName): Int16Array {
  const cached = decoded.get(name);
  if (cached) return cached;

  const source = SOURCES[name];
  const bytes = atob(source.base64);
  const cellCount = source.width * source.height;
  if (bytes.length !== cellCount * 2) {
    throw new Error(`Invalid ${name} topography byte length`);
  }

  const elevation = new Int16Array(cellCount);
  for (let i = 0; i < cellCount; i++) {
    const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
    elevation[i] = value >= 0x8000 ? value - 0x10000 : value;
  }
  decoded.set(name, elevation);
  return elevation;
}

/**
 * Resamples a global topography raster by the spherical area shared by each
 * source and target cell. Both grids start at the north pole and 0 degrees east.
 */
export function resampleTopography(name: TopographyName, grid: Grid): Float32Array {
  const source = SOURCES[name];
  const elevation = sourceElevation(name);
  const longitudeOverlaps = axisOverlaps(source.width, grid.width, true);
  const latitudeOverlaps = latitudeAxisOverlaps(source.height, grid.height);
  const result = new Float32Array(grid.cellCount);

  for (let y = 0; y < grid.height; y++) {
    const rows = latitudeOverlaps[y]!;
    for (let x = 0; x < grid.width; x++) {
      const columns = longitudeOverlaps[x]!;
      let weightedElevation = 0;
      let totalWeight = 0;
      for (const row of rows) {
        const offset = row.index * source.width;
        for (const column of columns) {
          const weight = row.weight * column.weight;
          weightedElevation += elevation[offset + column.index]! * weight;
          totalWeight += weight;
        }
      }
      result[y * grid.width + x] = weightedElevation / totalWeight;
    }
  }
  return result;
}

/** Overlaps on a uniform periodic axis, expressed in source-cell widths. */
function axisOverlaps(sourceCount: number, targetCount: number, wrap: boolean): Overlap[][] {
  return Array.from({ length: targetCount }, (_, target) => {
    const start = (target * sourceCount) / targetCount;
    const end = ((target + 1) * sourceCount) / targetCount;
    const overlaps: Overlap[] = [];
    for (let source = Math.floor(start); source < Math.ceil(end); source++) {
      const weight = Math.min(end, source + 1) - Math.max(start, source);
      if (weight <= 0) continue;
      const index = wrap ? ((source % sourceCount) + sourceCount) % sourceCount : source;
      overlaps.push({ index, weight });
    }
    return overlaps;
  });
}

/** Latitude overlaps weighted by sin(latitude), hence by exact spherical area. */
function latitudeAxisOverlaps(sourceCount: number, targetCount: number): Overlap[][] {
  return Array.from({ length: targetCount }, (_, target) => {
    const targetNorth = Math.PI / 2 - (target * Math.PI) / targetCount;
    const targetSouth = Math.PI / 2 - ((target + 1) * Math.PI) / targetCount;
    const first = Math.floor((target * sourceCount) / targetCount);
    const last = Math.ceil(((target + 1) * sourceCount) / targetCount);
    const overlaps: Overlap[] = [];
    for (let source = first; source < last; source++) {
      const sourceNorth = Math.PI / 2 - (source * Math.PI) / sourceCount;
      const sourceSouth = Math.PI / 2 - ((source + 1) * Math.PI) / sourceCount;
      const north = Math.min(targetNorth, sourceNorth);
      const south = Math.max(targetSouth, sourceSouth);
      const weight = Math.sin(north) - Math.sin(south);
      if (weight > 0) overlaps.push({ index: source, weight });
    }
    return overlaps;
  });
}
