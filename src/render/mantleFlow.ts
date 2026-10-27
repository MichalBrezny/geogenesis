import type { Projection, VectorField } from './arrows';

export interface PlateMotion {
  id: number;
  eulerPole: [number, number, number];
  angularSpeed: number;
}

export interface HotspotMarker {
  id: number;
  position: [number, number, number];
  strength: number;
}

/**
 * Converts Euler-pole rotations to east/north surface velocity in cm/yr. The
 * plate-id raster is already a rendered field, so no additional vector fields
 * cross the worker boundary.
 */
export function mantleVelocityField(source: {
  grid: { width: number; height: number };
  radius: number;
  plateId: ArrayLike<number>;
  plates: readonly PlateMotion[];
}): VectorField {
  const { width, height } = source.grid;
  const u = new Float32Array(width * height);
  const v = new Float32Array(width * height);
  const motions = new Map(source.plates.map((plate) => [plate.id, plate]));
  for (let y = 0; y < height; y++) {
    const latitude = 90 - ((y + 0.5) * 180) / height;
    const phi = (latitude * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const motion = motions.get(source.plateId[i]!);
      if (!motion) continue;
      const longitude = ((x + 0.5) * 2 * Math.PI) / width;
      const cosLon = Math.cos(longitude);
      const sinLon = Math.sin(longitude);
      const px = cosPhi * cosLon;
      const py = cosPhi * sinLon;
      const pz = sinPhi;
      const [ox, oy, oz] = motion.eulerPole.map(
        (component) => component * motion.angularSpeed,
      ) as [number, number, number];
      // omega cross (radius * position), projected onto local east and north.
      const vx = source.radius * (oy * pz - oz * py);
      const vy = source.radius * (oz * px - ox * pz);
      const vz = source.radius * (ox * py - oy * px);
      const east = -vx * sinLon + vy * cosLon;
      const north = -vx * sinPhi * cosLon - vy * sinPhi * sinLon + vz * cosPhi;
      u[i] = east * 100;
      v[i] = north * 100;
    }
  }
  return { width, height, u, v };
}

/** Mantle-frame plume centres, drawn as compact target symbols. */
export function drawHotspots(
  ctx: CanvasRenderingContext2D,
  hotspots: readonly HotspotMarker[],
  project: Projection,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 218, 112, 0.95)';
  ctx.fillStyle = 'rgba(218, 73, 43, 0.88)';
  ctx.lineWidth = 1.5;
  for (const hotspot of hotspots) {
    const [x, y, z] = hotspot.position;
    const latitude = (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI;
    const longitude = (((Math.atan2(y, x) * 180) / Math.PI + 360) % 360);
    const point = project(latitude, longitude);
    if (!point) continue;
    const radius = 3.5 + Math.min(2, hotspot.strength);
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(point[0], point[1], radius + 2.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
