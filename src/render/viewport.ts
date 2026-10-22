/**
 * Zoom and pan for the flat map. The viewport is the part of the
 * equirectangular map on screen: a zoom factor and the latitude/longitude at
 * its centre. Longitude wraps; latitude is clamped so the view never shows
 * past a pole.
 */
import type { Projection } from './arrows';

export interface MapViewport {
  /** 1 shows the whole planet; 2 shows half of it across and down. */
  zoom: number;
  /** Centre of the view, degrees (longitude 0…360 east). */
  latitude: number;
  longitude: number;
}

/** The part of the map in view, degrees; `west` may lie outside 0…360. */
export interface ViewBounds {
  west: number;
  north: number;
  lonSpan: number;
  latSpan: number;
}

export const FULL_VIEW: MapViewport = { zoom: 1, latitude: 0, longitude: 180 };
export const MAX_ZOOM = 16;

const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** Keeps the zoom in range, the view inside the poles and the longitude in 0…360. */
export function clampViewport(view: MapViewport): MapViewport {
  const zoom = clamp(view.zoom, 1, MAX_ZOOM);
  const halfLat = 90 / zoom;
  return {
    zoom,
    latitude: clamp(view.latitude, -90 + halfLat, 90 - halfLat),
    longitude: wrap360(view.longitude),
  };
}

export function viewBounds(view: MapViewport): ViewBounds {
  const lonSpan = 360 / view.zoom;
  const latSpan = 180 / view.zoom;
  return {
    west: view.longitude - lonSpan / 2,
    north: view.latitude + latSpan / 2,
    lonSpan,
    latSpan,
  };
}

/** Latitude/longitude under a point of the view given as fractions (0…1) of its width and height. */
export function viewportPoint(
  view: MapViewport,
  fx: number,
  fy: number,
): { latitude: number; longitude: number } {
  const { west, north, lonSpan, latSpan } = viewBounds(view);
  return { latitude: north - fy * latSpan, longitude: wrap360(west + fx * lonSpan) };
}

/** Zooms by `factor`, keeping the point at (fx, fy) of the view where it is on screen. */
export function zoomViewport(view: MapViewport, factor: number, fx = 0.5, fy = 0.5): MapViewport {
  const before = viewBounds(view);
  const longitude = before.west + fx * before.lonSpan;
  const latitude = before.north - fy * before.latSpan;
  const zoom = clamp(view.zoom * factor, 1, MAX_ZOOM);
  const after = viewBounds({ ...view, zoom });
  return clampViewport({
    zoom,
    longitude: longitude + (0.5 - fx) * after.lonSpan,
    latitude: latitude - (0.5 - fy) * after.latSpan,
  });
}

/** Moves the map with a drag of (dfx, dfy) view widths/heights. */
export function panViewport(view: MapViewport, dfx: number, dfy: number): MapViewport {
  const { lonSpan, latSpan } = viewBounds(view);
  return clampViewport({
    ...view,
    longitude: view.longitude - dfx * lonSpan,
    latitude: view.latitude + dfy * latSpan,
  });
}

/**
 * Equirectangular projection of the viewport onto `width` × `height` pixels.
 * Points outside the view land off the canvas: those just west of it stay to the
 * west (negative x), so lines crossing the west edge do not jump across the screen.
 * At zoom 1 centred on 180° it is the plain map projection.
 */
export function viewportProjection(width: number, height: number, view: MapViewport): Projection {
  const { west, north, lonSpan, latSpan } = viewBounds(view);
  const backEdge = 360 - (360 - lonSpan) / 2;
  return (latitude, longitude) => {
    const east = wrap360(longitude - west);
    const dx = east > backEdge ? east - 360 : east;
    return [(dx / lonSpan) * width, ((north - latitude) / latSpan) * height];
  };
}

/**
 * Draws the part of `source` (the map at 1 pixel per cell) in view onto `canvas`,
 * sized `width` × `height` CSS pixels at the device pixel ratio, with sharp cells.
 */
export function drawViewport(
  canvas: HTMLCanvasElement,
  source: HTMLCanvasElement,
  view: MapViewport,
  width: number,
  height: number,
): void {
  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  if (!ctx || source.width === 0 || canvas.width === 0) return;
  ctx.imageSmoothingEnabled = false;
  const { west, north, lonSpan, latSpan } = viewBounds(view);
  const sx = (wrap360(west) / 360) * source.width;
  const sy = ((90 - north) / 180) * source.height;
  const sw = (lonSpan / 360) * source.width;
  const sh = (latSpan / 180) * source.height;
  // The view may cross the map's east edge: draw the rest from its west edge.
  const first = Math.min(sw, source.width - sx);
  const split = Math.round((first / sw) * canvas.width);
  ctx.drawImage(source, sx, sy, first, sh, 0, 0, split, canvas.height);
  if (first < sw) {
    ctx.drawImage(source, 0, sy, sw - first, sh, split, 0, canvas.width - split, canvas.height);
  }
}
