import type { NamedMapFeature } from '../sim/mapNames';
import type { Projection } from './arrows';

interface LabelSource {
  grid: { width: number; height: number; cellCount: number };
  fields: { elevation: ArrayLike<number>; plateId: ArrayLike<number> };
  seaLevel: number;
  mapFeatures: readonly Omit<NamedMapFeature, 'footprint'>[];
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const LABEL_PRIORITY: Record<NamedMapFeature['kind'], number> = {
  continent: 0,
  ocean: 1,
  plate: 2,
  mountain: 3,
  island: 4,
  lake: 5,
  river: 6,
};

/** Draws stable feature names with a halo and greedy screen-space collision avoidance. */
export function drawMapLabels(
  ctx: CanvasRenderingContext2D,
  source: LabelSource,
  project: Projection,
  zoom: number,
): void {
  const occupied: Box[] = [];
  const features = source.mapFeatures
    .filter((feature) => visibleAtZoom(feature, zoom))
    .sort(
      (a, b) =>
        LABEL_PRIORITY[a.kind] - LABEL_PRIORITY[b.kind] || b.size - a.size || a.id - b.id,
    );
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  for (const feature of features) {
    const x = feature.cell % source.grid.width;
    const y = Math.floor(feature.cell / source.grid.width);
    const point = project(
      90 - ((y + 0.5) * 180) / source.grid.height,
      ((x + 0.5) * 360) / source.grid.width,
    );
    if (!point) continue;
    const fontSize = labelSize(feature, zoom);
    const italic = feature.kind === 'ocean' || feature.kind === 'river';
    ctx.font = `${italic ? 'italic ' : ''}${fontSize}px system-ui, sans-serif`;
    const width = ctx.measureText(feature.name).width + 8;
    const box = {
      left: point[0] - width / 2,
      right: point[0] + width / 2,
      top: point[1] - fontSize * 0.75,
      bottom: point[1] + fontSize * 0.75,
    };
    if (occupied.some((other) => intersects(box, other))) continue;
    occupied.push(box);
    ctx.lineWidth = Math.max(2.5, fontSize * 0.24);
    ctx.strokeStyle = 'rgba(13, 17, 22, 0.88)';
    ctx.fillStyle = feature.kind === 'ocean' ? '#d8edf4' : '#fff8df';
    ctx.strokeText(feature.name, point[0], point[1]);
    ctx.fillText(feature.name, point[0], point[1]);
  }
  ctx.restore();
}

function visibleAtZoom(feature: Omit<NamedMapFeature, 'footprint'>, zoom: number): boolean {
  if (feature.kind === 'plate' || feature.kind === 'continent' || feature.kind === 'ocean') return true;
  if (feature.kind === 'mountain') return zoom >= 1.3;
  if (feature.kind === 'island') return zoom >= 1.7 || feature.size >= 2e12;
  if (feature.kind === 'lake') return zoom >= 2;
  return zoom >= 2.5;
}

function labelSize(feature: Omit<NamedMapFeature, 'footprint'>, zoom: number): number {
  if (feature.kind === 'mountain' || feature.kind === 'river') return Math.min(14, 10 + zoom);
  const areaScale = Math.max(0, Math.log10(Math.max(1, feature.size)) - 11);
  return Math.max(10, Math.min(22, 10 + areaScale * 2 + Math.log2(Math.max(1, zoom))));
}

function intersects(a: Box, b: Box): boolean {
  const padding = 3;
  return !(
    a.right + padding < b.left ||
    a.left - padding > b.right ||
    a.bottom + padding < b.top ||
    a.top - padding > b.bottom
  );
}

interface GeographicIndex {
  region: Int32Array;
  names: Map<number, string>;
}

const geographicCache = new WeakMap<object, GeographicIndex>();

/** Finds the named continent/island or ocean containing a cell without another worker field. */
export function geographicNameAtCell(source: LabelSource, cell: number): string | undefined {
  let index = geographicCache.get(source as object);
  if (!index) {
    index = buildGeographicIndex(source);
    geographicCache.set(source as object, index);
  }
  return index.names.get(index.region[cell]!);
}

function buildGeographicIndex(source: LabelSource): GeographicIndex {
  const { width, height, cellCount } = source.grid;
  const region = new Int32Array(cellCount).fill(-1);
  let next = 0;
  for (let start = 0; start < cellCount; start++) {
    if (region[start]! >= 0) continue;
    const ocean = source.fields.elevation[start]! < source.seaLevel;
    const queue = [start];
    region[start] = next;
    for (let q = 0; q < queue.length; q++) {
      const current = queue[q]!;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [
        y > 0 ? current - width : -1,
        y * width + ((x + 1) % width),
        y + 1 < height ? current + width : -1,
        y * width + ((x + width - 1) % width),
      ];
      for (const neighbor of neighbors) {
        if (
          neighbor >= 0 &&
          region[neighbor]! < 0 &&
          (source.fields.elevation[neighbor]! < source.seaLevel) === ocean
        ) {
          region[neighbor] = next;
          queue.push(neighbor);
        }
      }
    }
    next++;
  }
  const names = new Map<number, string>();
  for (const feature of source.mapFeatures) {
    if (feature.kind === 'continent' || feature.kind === 'island' || feature.kind === 'ocean') {
      names.set(region[feature.cell]!, feature.name);
    }
  }
  return { region, names };
}

export function plateNameAtCell(source: LabelSource, cell: number): string | undefined {
  const plateId = source.fields.plateId[cell]!;
  return source.mapFeatures.find(
    (feature) => feature.kind === 'plate' && feature.plateId === plateId,
  )?.name;
}
