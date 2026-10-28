export interface GesturePoint {
  x: number;
  y: number;
}

export interface PinchGesture {
  /** Midpoint of the two current pointers. */
  centre: GesturePoint;
  /** Midpoint of the two pointers when the gesture began. */
  startCentre: GesturePoint;
  /** Current pointer distance divided by the starting distance. */
  scale: number;
}

const distance = (a: GesturePoint, b: GesturePoint) => Math.hypot(b.x - a.x, b.y - a.y);

const midpoint = (a: GesturePoint, b: GesturePoint): GesturePoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});

/** Pinch centre and scale, independent of pointer order. */
export function pinchGesture(
  startA: GesturePoint,
  startB: GesturePoint,
  currentA: GesturePoint,
  currentB: GesturePoint,
): PinchGesture {
  const startDistance = distance(startA, startB);
  return {
    centre: midpoint(currentA, currentB),
    startCentre: midpoint(startA, startB),
    scale: startDistance > 0 ? distance(currentA, currentB) / startDistance : 1,
  };
}

/** A short, steady press is a tap; travel at the threshold is a drag. */
export function isTap(start: GesturePoint, end: GesturePoint, threshold: number): boolean {
  return distance(start, end) < threshold;
}
