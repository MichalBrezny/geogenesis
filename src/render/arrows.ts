/**
 * Arrows for vector fields (winds, ocean currents) drawn over the map or the
 * globe. Points are sampled evenly in latitude and longitude and placed through
 * a projection, so the same code serves both views.
 */

/** Screen position (overlay pixels) of a point on the planet, or null if it is out of view. */
export type Projection = (latitude: number, longitude: number) => [number, number] | null;

export interface VectorField {
  width: number;
  height: number;
  /** Eastward and northward components per grid cell. */
  u: ArrayLike<number>;
  v: ArrayLike<number>;
}

export interface ArrowStyle {
  /** Degrees between arrows along a meridian. */
  spacing: number;
  /** Arrow length (px) per unit of speed, and the longest arrow. */
  pixelsPerUnit: number;
  maxLength: number;
  /** Speeds below this get no arrow. */
  minSpeed: number;
  color: string;
  lineWidth: number;
}

const DEG = Math.PI / 180;

/** Draws one arrow per sample point, pointing downwind (or downstream). */
export function drawArrows(
  ctx: CanvasRenderingContext2D,
  field: VectorField,
  project: Projection,
  style: ArrowStyle,
): void {
  const { width, height, u, v } = field;
  ctx.save();
  ctx.strokeStyle = style.color;
  ctx.fillStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.lineCap = 'round';
  for (let latitude = 90 - style.spacing / 2; latitude > -90; latitude -= style.spacing) {
    // Fewer arrows along the shorter parallels near the poles.
    const lonStep = style.spacing / Math.max(0.25, Math.cos(latitude * DEG));
    const count = Math.max(1, Math.round(360 / lonStep));
    // Stagger alternate rows so arrows do not line up in columns.
    const offset = (Math.round((90 - latitude) / style.spacing) % 2) * 0.5;
    for (let k = 0; k < count; k++) {
      const longitude = ((k + offset) * 360) / count;
      const x = Math.min(width - 1, Math.floor((longitude / 360) * width));
      const y = Math.min(height - 1, Math.max(0, Math.floor(((90 - latitude) / 180) * height)));
      const i = y * width + x;
      const east = u[i]!;
      const north = v[i]!;
      const speed = Math.hypot(east, north);
      if (speed < style.minSpeed) continue;
      const start = project(latitude, longitude);
      if (!start) continue;
      // Screen direction: project a point a little way along the vector.
      const step = 0.5;
      const ahead = project(
        latitude + (north / speed) * step,
        longitude + ((east / speed) * step) / Math.max(0.05, Math.cos(latitude * DEG)),
      );
      if (!ahead) continue;
      let dx = ahead[0] - start[0];
      let dy = ahead[1] - start[1];
      const norm = Math.hypot(dx, dy);
      if (norm === 0 || norm > 200) continue; // wrapped across the map edge
      dx /= norm;
      dy /= norm;
      const length = Math.min(style.maxLength, Math.max(4, speed * style.pixelsPerUnit));
      drawArrow(ctx, start[0] - (dx * length) / 2, start[1] - (dy * length) / 2, dx, dy, length);
    }
  }
  ctx.restore();
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  length: number,
): void {
  const tipX = x + dx * length;
  const tipY = y + dy * length;
  const head = Math.min(6, length * 0.4);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(tipX, tipY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * head - dy * head * 0.5, tipY - dy * head + dx * head * 0.5);
  ctx.lineTo(tipX - dx * head + dy * head * 0.5, tipY - dy * head - dx * head * 0.5);
  ctx.closePath();
  ctx.fill();
}

/** Equirectangular map projection onto a canvas `width` × `height` pixels. */
export function mapProjection(width: number, height: number): Projection {
  return (latitude, longitude) => [
    ((((longitude % 360) + 360) % 360) / 360) * width,
    ((90 - latitude) / 180) * height,
  ];
}

/** Orthographic globe projection onto a square canvas `size` pixels wide. */
export function globeProjection(
  size: number,
  view: { longitude: number; latitude: number },
): Projection {
  const lat0 = view.latitude * DEG;
  const sin0 = Math.sin(lat0);
  const cos0 = Math.cos(lat0);
  return (latitude, longitude) => {
    const phi = latitude * DEG;
    const lambda = (longitude - view.longitude) * DEG;
    const cosC = sin0 * Math.sin(phi) + cos0 * Math.cos(phi) * Math.cos(lambda);
    if (cosC <= 0.05) return null; // behind the limb
    const x = Math.cos(phi) * Math.sin(lambda);
    const y = cos0 * Math.sin(phi) - sin0 * Math.cos(phi) * Math.cos(lambda);
    return [((x + 1) / 2) * size, ((1 - y) / 2) * size];
  };
}
