import type { Projection } from './arrows';

export interface PressureField {
  width: number;
  height: number;
  values: ArrayLike<number>;
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

export interface Isobar {
  level: number;
  points: GeoPoint[];
  closed: boolean;
}

export interface PressureExtremum extends GeoPoint {
  kind: 'H' | 'L';
  value: number;
}

interface Endpoint {
  key: string;
  point: GeoPoint;
}

interface Segment {
  a: Endpoint;
  b: Endpoint;
}

type Edge = 'top' | 'right' | 'bottom' | 'left';

/** Extracts pressure contours at absolute multiples of `interval` hPa. */
export function extractIsobars(field: PressureField, interval = 4): Isobar[] {
  const { values } = field;
  if (values.length === 0 || interval <= 0) return [];
  let minimum = Infinity;
  let maximum = -Infinity;
  for (let i = 0; i < values.length; i++) {
    minimum = Math.min(minimum, values[i]!);
    maximum = Math.max(maximum, values[i]!);
  }
  const contours: Isobar[] = [];
  const first = Math.ceil(minimum / interval) * interval;
  for (let level = first; level < maximum; level += interval) {
    if (level <= minimum) continue;
    contours.push(...stitchSegments(level, marchingSegments(field, level)));
  }
  return contours;
}

/** Finds prominent two-dimensional highs and lows, suppressing nearby duplicate labels. */
export function findPressureExtrema(field: PressureField): PressureExtremum[] {
  const { width, height, values } = field;
  const radius = Math.max(2, Math.round(width / 32));
  const candidates: (PressureExtremum & { prominence: number })[] = [];
  // The top and bottom of an equirectangular raster are boundaries, not samples
  // beyond the poles, so they cannot establish a closed two-dimensional centre.
  for (let y = radius; y < height - radius; y++) {
    for (let x = 0; x < width; x++) {
      const value = values[y * width + x]!;
      let high = true;
      let low = true;
      let strictHigh = false;
      let strictLow = false;
      for (let dy = -1; dy <= 1; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const neighbor = values[row * width + wrap(x + dx, width)]!;
          if (value < neighbor) high = false;
          if (value > neighbor) low = false;
          if (value > neighbor) strictHigh = true;
          if (value < neighbor) strictLow = true;
        }
      }
      if ((!high || !strictHigh) && (!low || !strictLow)) continue;

      let localMinimum = value;
      let localMaximum = value;
      let rowMinimum = value;
      let rowMaximum = value;
      for (let dy = -radius; dy <= radius; dy++) {
        const row = y + dy;
        if (row < 0 || row >= height) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const sample = values[row * width + wrap(x + dx, width)]!;
          localMinimum = Math.min(localMinimum, sample);
          localMaximum = Math.max(localMaximum, sample);
          if (dy === 0) {
            rowMinimum = Math.min(rowMinimum, sample);
            rowMaximum = Math.max(rowMaximum, sample);
          }
        }
      }
      const isHigh = high && strictHigh;
      const prominence = isHigh ? value - localMinimum : localMaximum - value;
      const zonalRelief = isHigh ? value - rowMinimum : rowMaximum - value;
      // Zonal pressure belts are not discrete weather systems and should not be labelled.
      if (prominence < 1.5 || zonalRelief < 0.5) continue;
      candidates.push({
        kind: isHigh ? 'H' : 'L',
        value,
        latitude: sampleLatitude(y, height),
        longitude: sampleLongitude(x, width),
        prominence,
      });
    }
  }

  candidates.sort((a, b) => b.prominence - a.prominence);
  const selected: PressureExtremum[] = [];
  for (const candidate of candidates) {
    if (selected.some((other) => angularDistance(candidate, other) < 18)) continue;
    selected.push(candidate);
    if (selected.length >= 12) break;
  }
  return selected;
}

/** Draws 4 hPa isobars and clear pressure-centre labels through either planet projection. */
export function drawIsobars(
  ctx: CanvasRenderingContext2D,
  field: PressureField,
  project: Projection,
  viewport: { width: number; height: number },
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const jump = Math.max(viewport.width, viewport.height) * 0.4;
  for (const contour of extractIsobars(field)) {
    ctx.beginPath();
    let previous: [number, number] | null = null;
    for (const point of contour.points) {
      const screen = project(point.latitude, point.longitude);
      if (!screen) {
        previous = null;
        continue;
      }
      if (!previous || Math.hypot(screen[0] - previous[0], screen[1] - previous[1]) > jump) {
        ctx.moveTo(screen[0], screen[1]);
      } else {
        ctx.lineTo(screen[0], screen[1]);
      }
      previous = screen;
    }
    ctx.stroke();
  }

  ctx.font = 'bold 17px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(15, 23, 42, 0.9)';
  const labels: [number, number][] = [];
  for (const extremum of findPressureExtrema(field)) {
    const screen = project(extremum.latitude, extremum.longitude);
    if (!screen || labels.some(([x, y]) => Math.hypot(screen[0] - x, screen[1] - y) < 36)) continue;
    ctx.strokeText(extremum.kind, screen[0], screen[1]);
    ctx.fillStyle = extremum.kind === 'H' ? '#fecaca' : '#bfdbfe';
    ctx.fillText(extremum.kind, screen[0], screen[1]);
    labels.push(screen);
  }
  ctx.restore();
}

function marchingSegments(field: PressureField, level: number): Segment[] {
  const { width, height, values } = field;
  const segments: Segment[] = [];
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      const right = (x + 1) % width;
      const topLeft = values[y * width + x]!;
      const topRight = values[y * width + right]!;
      const bottomRight = values[(y + 1) * width + right]!;
      const bottomLeft = values[(y + 1) * width + x]!;
      const code =
        (topLeft >= level ? 1 : 0) |
        (topRight >= level ? 2 : 0) |
        (bottomRight >= level ? 4 : 0) |
        (bottomLeft >= level ? 8 : 0);
      const center = (topLeft + topRight + bottomRight + bottomLeft) / 4;
      for (const [a, b] of edgePairs(code, center >= level)) {
        segments.push({
          a: edgeEndpoint(field, level, x, y, a),
          b: edgeEndpoint(field, level, x, y, b),
        });
      }
    }
  }
  return segments;
}

function edgePairs(code: number, centerHigh: boolean): [Edge, Edge][] {
  switch (code) {
    case 1:
    case 14:
      return [['left', 'top']];
    case 2:
    case 13:
      return [['top', 'right']];
    case 3:
    case 12:
      return [['left', 'right']];
    case 4:
    case 11:
      return [['right', 'bottom']];
    case 5:
      return centerHigh
        ? [
            ['top', 'right'],
            ['bottom', 'left'],
          ]
        : [
            ['left', 'top'],
            ['right', 'bottom'],
          ];
    case 6:
    case 9:
      return [['top', 'bottom']];
    case 7:
    case 8:
      return [['left', 'bottom']];
    case 10:
      return centerHigh
        ? [
            ['left', 'top'],
            ['right', 'bottom'],
          ]
        : [
            ['top', 'right'],
            ['bottom', 'left'],
          ];
    default:
      return [];
  }
}

function edgeEndpoint(
  field: PressureField,
  level: number,
  x: number,
  y: number,
  edge: Edge,
): Endpoint {
  const { width, values } = field;
  const right = (x + 1) % width;
  const topLeft = values[y * width + x]!;
  const topRight = values[y * width + right]!;
  const bottomRight = values[(y + 1) * width + right]!;
  const bottomLeft = values[(y + 1) * width + x]!;
  switch (edge) {
    case 'top': {
      const t = fraction(level, topLeft, topRight);
      return { key: `h:${y}:${x}`, point: gridPoint(field, x + t, y) };
    }
    case 'right': {
      const t = fraction(level, topRight, bottomRight);
      return { key: `v:${y}:${right}`, point: gridPoint(field, x + 1, y + t) };
    }
    case 'bottom': {
      const t = fraction(level, bottomLeft, bottomRight);
      return { key: `h:${y + 1}:${x}`, point: gridPoint(field, x + t, y + 1) };
    }
    case 'left': {
      const t = fraction(level, topLeft, bottomLeft);
      return { key: `v:${y}:${x}`, point: gridPoint(field, x, y + t) };
    }
  }
}

function stitchSegments(level: number, segments: Segment[]): Isobar[] {
  const adjacent = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    for (const endpoint of [segments[i]!.a, segments[i]!.b]) {
      const entries = adjacent.get(endpoint.key);
      if (entries) entries.push(i);
      else adjacent.set(endpoint.key, [i]);
    }
  }
  const used = new Uint8Array(segments.length);
  const contours: Isobar[] = [];
  for (let start = 0; start < segments.length; start++) {
    if (used[start]) continue;
    used[start] = 1;
    const segment = segments[start]!;
    const points = [segment.a.point, segment.b.point];
    let startKey = segment.a.key;
    let endKey = segment.b.key;
    let closed = extend(false);
    if (!closed) closed = extend(true);
    if (closed) points[points.length - 1] = points[0]!;
    contours.push({ level, points, closed });

    function extend(atStart: boolean): boolean {
      while (true) {
        const key = atStart ? startKey : endKey;
        const next = adjacent.get(key)?.find((index) => !used[index]);
        if (next === undefined) return startKey === endKey;
        used[next] = 1;
        const joined = segments[next]!;
        const other = joined.a.key === key ? joined.b : joined.a;
        if (atStart) {
          points.unshift(other.point);
          startKey = other.key;
        } else {
          points.push(other.point);
          endKey = other.key;
        }
        if (startKey === endKey) return true;
      }
    }
  }
  return contours;
}

function gridPoint(field: PressureField, x: number, y: number): GeoPoint {
  return {
    latitude: sampleLatitude(y, field.height),
    longitude: ((sampleLongitude(x, field.width) % 360) + 360) % 360,
  };
}

function sampleLatitude(y: number, height: number): number {
  return 90 - ((y + 0.5) * 180) / height;
}

function sampleLongitude(x: number, width: number): number {
  return ((x + 0.5) * 360) / width;
}

function fraction(level: number, from: number, to: number): number {
  return from === to ? 0.5 : Math.max(0, Math.min(1, (level - from) / (to - from)));
}

function wrap(x: number, width: number): number {
  return ((x % width) + width) % width;
}

function angularDistance(a: GeoPoint, b: GeoPoint): number {
  const radians = Math.PI / 180;
  const latA = a.latitude * radians;
  const latB = b.latitude * radians;
  const dLat = latB - latA;
  const dLon = (b.longitude - a.longitude) * radians;
  const chord = Math.sin(dLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(dLon / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(chord)))) / radians;
}
