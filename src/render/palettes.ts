export type Rgb = readonly [number, number, number];

interface Stop {
  value: number;
  color: Rgb;
}

/** Returns a function mapping a value to a colour by linear interpolation between stops. */
export function gradient(stops: readonly Stop[]): (value: number) => Rgb {
  return (value) => {
    const first = stops[0]!;
    const last = stops[stops.length - 1]!;
    if (value <= first.value) return first.color;
    if (value >= last.value) return last.color;
    for (let i = 1; i < stops.length; i++) {
      const b = stops[i]!;
      if (value <= b.value) {
        const a = stops[i - 1]!;
        const t = (value - a.value) / (b.value - a.value);
        return [
          Math.round(a.color[0] + (b.color[0] - a.color[0]) * t),
          Math.round(a.color[1] + (b.color[1] - a.color[1]) * t),
          Math.round(a.color[2] + (b.color[2] - a.color[2]) * t),
        ];
      }
    }
    return last.color;
  };
}

export const elevationPalette = gradient([
  { value: -8000, color: [8, 24, 68] },
  { value: -200, color: [40, 100, 170] },
  { value: 0, color: [90, 150, 200] },
  { value: 1, color: [70, 130, 60] },
  { value: 1000, color: [170, 160, 90] },
  { value: 3000, color: [130, 100, 80] },
  { value: 5000, color: [240, 240, 240] },
]);

export const temperaturePalette = gradient([
  { value: -40, color: [60, 20, 140] },
  { value: -10, color: [70, 130, 220] },
  { value: 10, color: [120, 210, 140] },
  { value: 25, color: [240, 200, 60] },
  { value: 40, color: [200, 40, 30] },
]);

export const precipitationPalette = gradient([
  { value: 0, color: [150, 100, 50] },
  { value: 250, color: [210, 180, 110] },
  { value: 600, color: [190, 210, 120] },
  { value: 1200, color: [80, 170, 90] },
  { value: 2500, color: [40, 110, 170] },
  { value: 4000, color: [30, 50, 140] },
]);

/** Wind speed (m/s): calm dark blue to strong pale cyan, on the dark map. */
export const windSpeedPalette = gradient([
  { value: 0, color: [22, 32, 58] },
  { value: 3, color: [36, 82, 140] },
  { value: 6, color: [57, 135, 229] },
  { value: 9, color: [120, 190, 236] },
  { value: 12, color: [215, 240, 250] },
]);

/** Sea surface temperature anomaly (°C): cold currents blue, warm currents red. */
export const seaAnomalyPalette = gradient([
  { value: -6, color: [40, 90, 190] },
  { value: -2, color: [120, 160, 215] },
  { value: 0, color: [215, 215, 215] },
  { value: 2, color: [230, 150, 120] },
  { value: 6, color: [195, 50, 40] },
]);
