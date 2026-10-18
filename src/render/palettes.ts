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

/** Seasonal monthly-mean temperature amplitude (°C), calm to strongly continental. */
export const seasonalRangePalette = gradient([
  { value: 0, color: [28, 48, 82] },
  { value: 2, color: [42, 105, 150] },
  { value: 6, color: [72, 166, 172] },
  { value: 12, color: [210, 198, 105] },
  { value: 20, color: [224, 126, 61] },
  { value: 30, color: [160, 42, 45] },
]);

export const precipitationPalette = gradient([
  { value: 0, color: [150, 100, 50] },
  { value: 250, color: [210, 180, 110] },
  { value: 600, color: [190, 210, 120] },
  { value: 1200, color: [80, 170, 90] },
  { value: 2500, color: [40, 110, 170] },
  { value: 4000, color: [30, 50, 140] },
]);

/** Relative volcanic activity: dim background through orange to incandescent yellow. */
export const volcanicPalette = gradient([
  { value: 0, color: [18, 22, 28] },
  { value: 0.2, color: [67, 43, 46] },
  { value: 1, color: [180, 57, 35] },
  { value: 3, color: [241, 137, 43] },
  { value: 6, color: [255, 235, 132] },
]);

/** Sea-level pressure (hPa): cool lows and warm highs, centred on 1013 hPa. */
export const pressurePalette = gradient([
  { value: 997, color: [38, 92, 170] },
  { value: 1005, color: [105, 164, 210] },
  { value: 1013, color: [218, 220, 211] },
  { value: 1021, color: [224, 153, 91] },
  { value: 1029, color: [177, 62, 47] },
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

/** Cloud cover (%): dark sky to white overcast. */
export const cloudPalette = gradient([
  { value: 0, color: [16, 30, 52] },
  { value: 100, color: [242, 244, 248] },
]);

/** Number of life classes present: dark blue (one) to pale yellow (a full community). */
export const diversityPalette = gradient([
  { value: 1, color: [30, 60, 110] },
  { value: 5, color: [34, 150, 150] },
  { value: 10, color: [140, 205, 110] },
  { value: 15, color: [250, 240, 150] },
]);
