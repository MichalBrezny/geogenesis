import type { Projection } from './arrows';

export interface PressureField {
  width: number;
  height: number;
  values: ArrayLike<number>;
  /** Optional terrain used to split fallback labels by land/sea sector and draw coasts. */
  elevation?: ArrayLike<number>;
  /** Current sea-surface elevation used with `elevation`. */
  seaLevel?: number;
  /** Planet radius in km for label spacing; defaults to Earth's. */
  radiusKm?: number;
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

interface ExtremumCandidate extends PressureExtremum {
  prominence: number;
  fallback: boolean;
  belt: number;
}

/** Weather systems are compared within about 2,500 km of their centre. */
const EXTREMUM_RADIUS_KM = 2_500;
/** Labels remain at least this far apart on the surface. */
export const PRESSURE_LABEL_MIN_SPACING_KM = 3_000;
const MIN_PROMINENCE = 2.5;
const MAX_LABELS = 12;
const EARTH_RADIUS_KM = 6_371;
const kmPerDegree = (radiusKm = EARTH_RADIUS_KM) => (Math.PI * radiusKm) / 180;

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

/**
 * Finds the main centres along pressure belts, suppressing nearby labels.
 *
 * A belt is a meridional extremum of the zonal-mean pressure. Within it, the
 * finder follows the ridge/trough as its latitude bends and looks for prominent
 * extrema along that track. This labels a stronger lobe of an otherwise open
 * zonal band, unlike a conventional closed-extremum search. If a belt has no
 * 2.5 hPa lobe, its strongest point in each broad land/sea sector is used.
 */
export function findPressureExtrema(field: PressureField): PressureExtremum[] {
  const { width, height, values } = field;
  if (width < 2 || height < 2 || values.length < width * height) return [];
  const KM_PER_DEGREE = kmPerDegree(field.radiusKm);
  const radiusDegrees = EXTREMUM_RADIUS_KM / KM_PER_DEGREE;
  const latitudeStep = 180 / height;
  const beltRadius = Math.max(1, Math.ceil(radiusDegrees / latitudeStep));
  const trackRadius = Math.max(1, Math.round(beltRadius / 2));
  const zonalMean = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    let sum = 0;
    for (let x = 0; x < width; x++) sum += values[y * width + x]!;
    zonalMean[y] = sum / width;
  }

  const candidates: ExtremumCandidate[] = [];
  // A full-radius neighbourhood must fit on both sides: the raster stops at the poles.
  for (let y = beltRadius; y < height - beltRadius; y++) {
    let localMinimum = Infinity;
    let localMaximum = -Infinity;
    for (let row = y - beltRadius; row <= y + beltRadius; row++) {
      localMinimum = Math.min(localMinimum, zonalMean[row]!);
      localMaximum = Math.max(localMaximum, zonalMean[row]!);
    }
    const mean = zonalMean[y]!;
    if (mean >= localMaximum && mean - localMinimum >= MIN_PROMINENCE) {
      addBeltCandidates(field, y, trackRadius, 'H', mean - localMinimum, candidates);
    }
    if (mean <= localMinimum && localMaximum - mean >= MIN_PROMINENCE) {
      addBeltCandidates(field, y, trackRadius, 'L', localMaximum - mean, candidates);
    }
  }

  // Observed lobes take precedence. Interleave fallback belts so a long coastline
  // cannot fill the label budget before the opposite hemisphere is represented.
  const observed = candidates
    .filter((candidate) => !candidate.fallback)
    .sort((a, b) => b.prominence - a.prominence);
  const fallbackBelts = new Map<number, ExtremumCandidate[]>();
  for (const candidate of candidates) {
    if (!candidate.fallback) continue;
    const belt = fallbackBelts.get(candidate.belt);
    if (belt) belt.push(candidate);
    else fallbackBelts.set(candidate.belt, [candidate]);
  }
  const belts = [...fallbackBelts.values()].sort((a, b) => b[0]!.prominence - a[0]!.prominence);
  for (const belt of belts) {
    belt.sort((a, b) => (a.kind === 'H' ? b.value - a.value : a.value - b.value));
  }
  const candidatesInPriorityOrder = [...observed];
  for (let rank = 0; belts.some((belt) => rank < belt.length); rank++) {
    for (const belt of belts) {
      if (belt[rank]) candidatesInPriorityOrder.push(belt[rank]!);
    }
  }
  const selected: PressureExtremum[] = [];
  for (const candidate of candidatesInPriorityOrder) {
    if (
      selected.some(
        (other) =>
          angularDistance(candidate, other) * KM_PER_DEGREE < PRESSURE_LABEL_MIN_SPACING_KM,
      )
    ) {
      continue;
    }
    selected.push({
      kind: candidate.kind,
      value: candidate.value,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
    });
    if (selected.length >= MAX_LABELS) break;
  }
  return selected;
}

function addBeltCandidates(
  field: PressureField,
  centreY: number,
  latitudeRadius: number,
  kind: PressureExtremum['kind'],
  beltProminence: number,
  out: ExtremumCandidate[],
): void {
  const { width, height, values } = field;
  const trackValues = new Float64Array(width);
  const trackRows = new Int32Array(width);
  const firstRow = Math.max(0, centreY - latitudeRadius);
  const lastRow = Math.min(height - 1, centreY + latitudeRadius);
  for (let x = 0; x < width; x++) {
    let bestRow = centreY;
    let best = values[centreY * width + x]!;
    for (let y = firstRow; y <= lastRow; y++) {
      const sample = values[y * width + x]!;
      if ((kind === 'H' && sample > best) || (kind === 'L' && sample < best)) {
        best = sample;
        bestRow = y;
      }
    }
    trackValues[x] = best;
    trackRows[x] = bestRow;
  }

  const beltCandidates: ExtremumCandidate[] = [];
  const longitudeStep = 360 / width;
  const radiusDegrees = EXTREMUM_RADIUS_KM / kmPerDegree(field.radiusKm);
  for (let x = 0; x < width; x++) {
    const latitude = sampleLatitude(trackRows[x]!, height);
    const longitudinalRadius = Math.min(
      Math.floor((width - 1) / 2),
      Math.max(
        1,
        Math.ceil(radiusDegrees / (longitudeStep * Math.max(0.15, Math.cos(toRadians(latitude))))),
      ),
    );
    const value = trackValues[x]!;
    let localMinimum = value;
    let localMaximum = value;
    let tiedEarlier = false;
    for (let offset = -longitudinalRadius; offset <= longitudinalRadius; offset++) {
      if (offset === 0) continue;
      const otherX = wrap(x + offset, width);
      const sample = trackValues[otherX]!;
      localMinimum = Math.min(localMinimum, sample);
      localMaximum = Math.max(localMaximum, sample);
      if (sample === value && otherX < x) tiedEarlier = true;
    }
    const isExtremum = kind === 'H' ? value >= localMaximum : value <= localMinimum;
    const prominence = kind === 'H' ? value - localMinimum : localMaximum - value;
    if (!tiedEarlier && isExtremum && prominence >= MIN_PROMINENCE) {
      beltCandidates.push({
        kind,
        value,
        latitude,
        longitude: sampleLongitude(x, width),
        prominence,
        fallback: false,
        belt: centreY,
      });
    }
  }
  if (beltCandidates.length > 0) {
    out.push(...beltCandidates);
    return;
  }

  // A nearly uniform belt still represents a real pressure system. Put one
  // label in each broad land/ocean sector, choosing that sector's strongest cell.
  for (const sector of surfaceSectors(field, centreY, latitudeRadius)) {
    let bestX = sector[0]!;
    for (const x of sector) {
      if (
        (kind === 'H' && trackValues[x]! > trackValues[bestX]!) ||
        (kind === 'L' && trackValues[x]! < trackValues[bestX]!)
      ) {
        bestX = x;
      }
    }
    const row = trackRows[bestX]!;
    out.push({
      kind,
      value: trackValues[bestX]!,
      latitude: sampleLatitude(row, height),
      longitude: sampleLongitude(bestX, width),
      prominence: beltProminence,
      fallback: true,
      belt: centreY,
    });
  }
}

/** Contiguous, longitudinal land/sea runs through a pressure belt. */
function surfaceSectors(field: PressureField, centreY: number, latitudeRadius: number): number[][] {
  const { width, height, elevation } = field;
  const all = Array.from({ length: width }, (_, x) => x);
  if (!elevation || elevation.length < width * height) return [all];
  const firstRow = Math.max(0, centreY - latitudeRadius);
  const lastRow = Math.min(height - 1, centreY + latitudeRadius);
  const seaLevel = field.seaLevel ?? 0;
  const land = new Uint8Array(width);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = firstRow; y <= lastRow; y++) {
      if (elevation[y * width + x]! >= seaLevel) count++;
    }
    land[x] = count * 2 >= lastRow - firstRow + 1 ? 1 : 0;
  }
  let boundary = -1;
  for (let x = 0; x < width; x++) {
    if (land[x] !== land[wrap(x - 1, width)]) {
      boundary = x;
      break;
    }
  }
  if (boundary < 0) return [all];
  const sectors: number[][] = [];
  let sector: number[] = [];
  for (let offset = 0; offset < width; offset++) {
    const x = wrap(boundary + offset, width);
    if (sector.length > 0 && land[x] !== land[sector[0]!]!) {
      sectors.push(sector);
      sector = [];
    }
    sector.push(x);
  }
  if (sector.length > 0) sectors.push(sector);
  // Ignore island-sized runs; they are too narrow to deserve another label.
  const minimumWidth = Math.max(2, Math.round(width / 24));
  const broad = sectors.filter((candidate) => candidate.length >= minimumWidth);
  return broad.length > 0 ? broad : [all];
}

/** Draws 4 hPa isobars and clear pressure-centre labels through either planet projection. */
export function drawIsobars(
  ctx: CanvasRenderingContext2D,
  field: PressureField,
  project: Projection,
  viewport: { width: number; height: number },
): void {
  ctx.save();
  const jump = Math.max(viewport.width, viewport.height) * 0.4;
  if (field.elevation && field.elevation.length >= field.width * field.height) {
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.72)';
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawProjectedContours(
      ctx,
      stitchSegments(
        field.seaLevel ?? 0,
        marchingSegments(
          { width: field.width, height: field.height, values: field.elevation },
          field.seaLevel ?? 0,
        ),
      ),
      project,
      jump,
    );
  }

  ctx.strokeStyle = 'rgba(248, 250, 252, 0.72)';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  drawProjectedContours(ctx, extractIsobars(field), project, jump);

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

function drawProjectedContours(
  ctx: CanvasRenderingContext2D,
  contours: readonly Isobar[],
  project: Projection,
  jump: number,
): void {
  for (const contour of contours) {
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

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
