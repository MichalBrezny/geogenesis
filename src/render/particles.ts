/**
 * Animated flow particles for vector fields, in the style of earth.nullschool
 * and windy.com: particles drift with the wind or the current and leave fading
 * trails. Particles live in latitude/longitude, so they work through any
 * projection (map or globe) and keep flowing while the globe turns.
 */
import type { Projection, VectorField } from './arrows';

export interface FlowStyle {
  /** Degrees of latitude a particle moves per frame per unit of speed. */
  degreesPerUnit: number;
  /** Particles slower than this are respawned (calm air, land for currents). */
  minSpeed: number;
  color: string;
  lineWidth: number;
  /** Particles per 1000 screen pixels² of the view. */
  density: number;
}

interface Particle {
  latitude: number;
  longitude: number;
  age: number;
}

export interface FlowLayer {
  field: VectorField;
  style: FlowStyle;
  particles: Particle[];
}

/** Frames a particle lives before it is reborn somewhere else. */
const MAX_AGE = 70;
/** Share of the trails kept from one frame to the next (lower = shorter trails). */
const TRAIL_FADE = 0.97;
const DEG = Math.PI / 180;

/** Bilinear value of a cell field at a latitude/longitude (x wraps). */
function sample(
  values: ArrayLike<number>,
  width: number,
  height: number,
  lat: number,
  lon: number,
) {
  const fx = ((((lon % 360) + 360) % 360) / 360) * width - 0.5;
  const fy = Math.max(0, Math.min(height - 1, ((90 - lat) / 180) * height - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const xa = (x0 + width) % width;
  const xb = (xa + 1) % width;
  const ya = y0;
  const yb = Math.min(height - 1, y0 + 1);
  const at = (x: number, y: number) => values[y * width + x]!;
  return (
    (at(xa, ya) * (1 - tx) + at(xb, ya) * tx) * (1 - ty) +
    (at(xa, yb) * (1 - tx) + at(xb, yb) * tx) * ty
  );
}

/** A new particle at a random place where the field flows (tries a few times). */
function spawn(field: VectorField, style: FlowStyle): Particle {
  let latitude = 0;
  let longitude = 0;
  for (let attempt = 0; attempt < 8; attempt++) {
    // Uniform on the sphere.
    latitude = Math.asin(2 * Math.random() - 1) / DEG;
    longitude = Math.random() * 360;
    const u = sample(field.u, field.width, field.height, latitude, longitude);
    const v = sample(field.v, field.width, field.height, latitude, longitude);
    if (Math.hypot(u, v) >= style.minSpeed) break;
  }
  return { latitude, longitude, age: Math.floor(Math.random() * MAX_AGE) };
}

export function createFlowLayer(field: VectorField, style: FlowStyle, area: number): FlowLayer {
  // The globe shows half the planet at a time, the map all of it; count per screen area.
  const count = Math.min(8000, Math.round((area / 1000) * style.density));
  const particles = Array.from({ length: count }, () => spawn(field, style));
  return { field, style, particles };
}

/** Fades the previous trails, moves every particle one frame and draws its new segment. */
export function stepFlow(
  ctx: CanvasRenderingContext2D,
  layers: readonly FlowLayer[],
  project: Projection,
  width: number,
  height: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = `rgba(0, 0, 0, ${TRAIL_FADE})`;
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = 'source-over';
  for (const layer of layers) {
    const { field, style } = layer;
    ctx.strokeStyle = style.color;
    ctx.lineWidth = style.lineWidth;
    ctx.beginPath();
    for (let k = 0; k < layer.particles.length; k++) {
      const p = layer.particles[k]!;
      const u = sample(field.u, field.width, field.height, p.latitude, p.longitude);
      const v = sample(field.v, field.width, field.height, p.latitude, p.longitude);
      const speed = Math.hypot(u, v);
      if (p.age++ > MAX_AGE || speed < style.minSpeed || Math.abs(p.latitude) > 85) {
        layer.particles[k] = spawn(field, style);
        continue;
      }
      const from = project(p.latitude, p.longitude);
      p.latitude += v * style.degreesPerUnit;
      p.longitude += (u * style.degreesPerUnit) / Math.max(0.1, Math.cos(p.latitude * DEG));
      const to = project(p.latitude, p.longitude);
      // Skip segments that are out of view or jump across the map's edge.
      if (!from || !to || Math.abs(to[0] - from[0]) > width / 4) continue;
      ctx.moveTo(from[0], from[1]);
      ctx.lineTo(to[0], to[1]);
    }
    ctx.stroke();
  }
  ctx.restore();
}
