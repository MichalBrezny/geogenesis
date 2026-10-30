import type { ReactNode } from 'react';
import type { MapLayer } from '../render/mapRenderer';
import type { ToolId } from '../sim/tools/tools';
import type { Overlay, View } from './PlanetView';
import type { ControlGroupId } from './ControlsPanel';
import { EVENT_ICON_PATHS } from '../render/mapIcons';
import type { EventKey } from '../sim/events';
import type { DisasterSettings } from '../sim/core/planet';
import type { ScenarioId } from '../sim/scenarios';
import type { PlanetStart } from '../sim/world';

/**
 * Line icons drawn on a 24-unit grid in the current text colour, so they follow
 * the button state and the theme.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** Shared filled map/event art, suitable for legends and compact log entries. */
export function GlyphIcon({ path, className = '' }: { path: string; className?: string }) {
  return (
    <svg
      className={`map-glyph ${className}`.trim()}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="0.8"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

export function EventIcon({ eventKey }: { eventKey: EventKey }) {
  return <GlyphIcon path={EVENT_ICON_PATHS[eventKey]} className="event-icon" />;
}

const MOUNTAIN = 'M2 20 8 10l4 6 3-4 7 8Z';
const FACTORY = 'M3 21V12l5 3v-3l5 3V9h4v12Z';
const CLOUD = 'M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.5 4.25 4.25 0 0 0 7 18Z';
const QUAKE = 'M2 18 7 13l3 3 3-9 3 6 6-5M3 21h18';
const WAVE = 'M2 16c3-4 6-4 9 0s6 4 11 0M2 20c3-4 6-4 9 0s6 4 11 0';
const CYCLONE = 'M12 12c-5-1-7-5-5-8m5 8c1-5 5-7 8-5m-8 5c5 1 7 5 5 8m-5-8c-1 5-5 7-8 5';
const FIRE =
  'M12 22c-5 0-8-3-7-8 1-4 5-6 5-11 4 3 7 7 7 11 0 5-3 8-7 8Zm0-3c-2 0-3-2-2-4l2-4c2 2 3 4 2 6 0 1-1 2-2 2Z';

export const TOOL_ICONS: Record<ToolId, ReactNode> = {
  raise: (
    <Icon>
      <path d={MOUNTAIN} />
      <path d="M18 9V2m-2.5 2.5L18 2l2.5 2.5" />
    </Icon>
  ),
  lower: (
    <Icon>
      <path d={MOUNTAIN} />
      <path d="M18 2v7m-2.5-2.5L18 9l2.5-2.5" />
    </Icon>
  ),
  volcano: (
    <Icon>
      <path d="M2 21 8.5 11h7L22 21Z" />
      <path d="M10 8c0-2 4-2 4-4m-2 4c0-1.5 3-2 3-4" />
    </Icon>
  ),
  meteor: (
    <Icon>
      <circle cx="8" cy="16" r="4" />
      <path d="M11 13 20 4m-8 13 9-9M7 11l8-8" />
    </Icon>
  ),
  seedLife: (
    <Icon>
      <path d="M12 21v-9" />
      <path d="M12 14c0-4.5-3-7-8-7 0 4.5 3 7 8 7Z" />
      <path d="M12 12c0-4.5 3-8 8-8 0 4.5-3 8-8 8Z" />
    </Icon>
  ),
  monolith: (
    <Icon>
      <path d="M9 4h6v17H9Z" />
      <path d="M3 21h18M18 3l1-1m1 4h1" />
    </Icon>
  ),
  addCo2: (
    <Icon>
      <path d={CLOUD} />
      <path d="M12 11v5m-2.5-2.5h5" />
    </Icon>
  ),
  removeCo2: (
    <Icon>
      <path d={CLOUD} />
      <path d="M9.5 13.5h5" />
    </Icon>
  ),
  iceMeteor: (
    <Icon>
      <path d="M8 12v8m-3.5-6 7 4m-7 0 7-4" />
      <path d="M12 9 20 2m-5 9 6-5" />
    </Icon>
  ),
  co2Generator: (
    <Icon>
      <path d={FACTORY} />
      <path d="M18 7c0-2 2-2 2-4" />
    </Icon>
  ),
  n2Generator: (
    <Icon>
      <path d={FACTORY} />
      <path d="M16 6c1-1.5 2 1.5 3 0s2 1.5 3 0" />
    </Icon>
  ),
  o2Generator: (
    <Icon>
      <path d={FACTORY} />
      <circle cx="19" cy="5" r="2" />
    </Icon>
  ),
  co2Scrubber: (
    <Icon>
      <path d="M3 4h18l-7 8v6l-4 3v-9Z" />
    </Icon>
  ),
  biomeFactory: (
    <Icon>
      <path d="M3 21a9 9 0 0 1 18 0Z" />
      <path d="M12 21v-6m0 2c-2 0-3-1.5-3-3.5 2 0 3 1.5 3 3.5Zm0-1c2 0 3-1.5 3-3.5-2 0-3 1.5-3 3.5Z" />
    </Icon>
  ),
  earthquake: (
    <Icon>
      <path d={QUAKE} />
      <path d="M5 5h14m-3-3 3 3-3 3" />
    </Icon>
  ),
  hurricane: (
    <Icon>
      <path d={CYCLONE} />
    </Icon>
  ),
  tidalWave: (
    <Icon>
      <path d={WAVE} />
      <path d="M3 12c4-8 10-9 18-5-5 0-7 3-7 6" />
    </Icon>
  ),
  fire: (
    <Icon>
      <path d={FIRE} />
    </Icon>
  ),
};

export const LAYER_ICONS: Record<MapLayer, ReactNode> = {
  terrain: (
    <Icon>
      <path d={MOUNTAIN} />
      <path d="m6.5 12.5 1.5 1 1.5-1" />
    </Icon>
  ),
  seafloor: (
    <Icon>
      <path d="M2 17c4-5 7-5 10 0 3-5 6-5 10 0M2 10c4 3 7 3 10 0 3 3 6 3 10 0" />
      <path d="M2 21h20" />
    </Icon>
  ),
  plates: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="m4 9 6 2-1 5 3 5m-2-10 7-5m-5 10 8 1" />
    </Icon>
  ),
  volcanism: (
    <Icon>
      <path d="M2 21 8.5 11h7L22 21Z" />
      <path d="M10 8c0-2 4-2 4-4m-2 4c0-1.5 3-2 3-4" />
    </Icon>
  ),
  airTemperature: (
    <Icon>
      <path d="M14 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0Z" />
      <path d="M12 9v7" />
    </Icon>
  ),
  seasons: (
    <Icon>
      <circle cx="7" cy="7" r="3" />
      <path d="M7 1v2m0 8v2M1 7h2m8 0h2M15 4v16m-3-3 3 3 3-3M12 7l3-3 3 3" />
    </Icon>
  ),
  pressure: (
    <Icon>
      <path d="M3 7c3-3 6 3 9 0s6 3 9 0M3 12c3-3 6 3 9 0s6 3 9 0M3 17c3-3 6 3 9 0s6 3 9 0" />
    </Icon>
  ),
  precipitation: (
    <Icon>
      <path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z" />
    </Icon>
  ),
  biomes: (
    <Icon>
      <path d="M12 2 5 14h14Z" />
      <path d="M12 14v8m-4 0h8" />
    </Icon>
  ),
  life: (
    <Icon>
      <path d="M3 12c4-6 11-6 15 0-4 6-11 6-15 0Z" />
      <path d="m18 12 3-3v6Z" />
      <circle cx="8" cy="11" r="0.5" fill="currentColor" />
    </Icon>
  ),
  diversity: (
    <Icon>
      <circle cx="7" cy="8" r="3" />
      <circle cx="17" cy="8" r="3" />
      <circle cx="12" cy="16" r="3" />
    </Icon>
  ),
  civilization: (
    <Icon>
      <path d="M2 21h20M4 21V11l4-3v13m0 0V4h7v17m0 0V11h5v10" />
      <path d="M11 8h1m-1 4h1m-1 4h1" />
    </Icon>
  ),
  hazard: (
    <Icon>
      <path d="M12 2 2 21h20Z" />
      <path d="M12 8v6m0 3v.5" />
    </Icon>
  ),
  clouds: (
    <Icon>
      <path d={CLOUD} />
    </Icon>
  ),
  wind: (
    <Icon>
      <path d="M3 8h11a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7" />
    </Icon>
  ),
  oceanCurrents: (
    <Icon>
      <path d="M2 9c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0M2 15c2.5-2 4.5-2 7 0s4.5 2 7 0 4.5-2 6 0" />
    </Icon>
  ),
  oceanOxygen: (
    <Icon>
      <path d="M12 3s-6 7-6 11a6 6 0 0 0 12 0c0-4-6-11-6-11Z" />
      <circle cx="10" cy="14" r="1" />
      <circle cx="14" cy="11" r="1.5" />
    </Icon>
  ),
  nutrients: (
    <Icon>
      <path d="M4 17c4-7 9-10 16-10-1 7-5 11-12 11" />
      <path d="M4 21c2-6 6-9 12-11" />
    </Icon>
  ),
  clathrates: (
    <Icon>
      <path d="m12 2 8 5v10l-8 5-8-5V7Z" />
      <path d="m4 7 8 5 8-5m-8 5v10" />
    </Icon>
  ),
  daisies: (
    <Icon>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 9.5a3 3 0 1 1 0-6 3 3 0 1 1 0 6Zm0 5a3 3 0 1 1 0 6 3 3 0 1 1 0-6Zm-2.5-2.5a3 3 0 1 1-6 0 3 3 0 1 1 6 0Zm5 0a3 3 0 1 1 6 0 3 3 0 1 1-6 0Z" />
    </Icon>
  ),
};

export const DISASTER_ICONS: Record<keyof DisasterSettings, ReactNode> = {
  earthquakes: (
    <Icon>
      <path d={QUAKE} />
    </Icon>
  ),
  tsunamis: (
    <Icon>
      <path d={WAVE} />
    </Icon>
  ),
  cyclones: (
    <Icon>
      <path d={CYCLONE} />
    </Icon>
  ),
  droughts: (
    <Icon>
      <circle cx="17" cy="7" r="3" />
      <path d="M3 21 8 12l3 4 3-3 7 8M17 1v2m0 8v2m-6-6h2m8 0h2" />
    </Icon>
  ),
  dustStorms: (
    <Icon>
      <path d="M2 8h12c4 0 4-5 1-5-2 0-2 2-2 2M2 13h17c4 0 4 5 1 5-2 0-2-2-2-2M2 18h10" />
    </Icon>
  ),
  impacts: TOOL_ICONS.meteor,
  supervolcanoes: TOOL_ICONS.volcano,
};

export const OVERLAY_ICONS: Record<Overlay, ReactNode> = {
  ambient: (
    <Icon>
      <path d="M3 16c3-3 6-3 9 0s6 3 9 0M6 9h.1M12 6h.1M18 10h.1" />
      <path d="M15 19c0-3 3-3 3-6" />
    </Icon>
  ),
  wind: LAYER_ICONS.wind,
  currents: LAYER_ICONS.oceanCurrents,
  isobars: LAYER_ICONS.pressure,
  mantle: (
    <Icon>
      <path d="M3 17h13m0 0-4-4m4 4-4 4M5 7h13m0 0-4-4m4 4-4 4" />
    </Icon>
  ),
  names: (
    <Icon>
      <path d="M4 20 10 4h4l6 16M7 14h10" />
    </Icon>
  ),
  icons: (
    <Icon>
      <path d="M3 20V9l5-4 4 4 4-6 5 5v12Z" />
      <circle cx="8" cy="13" r="1.5" fill="currentColor" />
      <path d="M14 20v-6h4v6" />
    </Icon>
  ),
  events: (
    <Icon>
      <path d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Z" />
      <circle cx="12" cy="9" r="2" />
    </Icon>
  ),
};

export const VIEW_ICONS: Record<View, ReactNode> = {
  map: (
    <Icon>
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <path d="M9 5v14m6-14v14M2 12h20" />
    </Icon>
  ),
  globe: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <ellipse cx="12" cy="12" rx="4" ry="9" />
      <path d="M3 12h18" />
    </Icon>
  ),
};

/** Distinct scenario and starting-point art for the New Planet cards. */
export const SCENARIO_ICONS: Record<ScenarioId, ReactNode> = {
  random: VIEW_ICONS.globe,
  daisyworld: LAYER_ICONS.daisies,
  aquarium: LAYER_ICONS.oceanCurrents,
  mars: TOOL_ICONS.meteor,
  venus: LAYER_ICONS.clouds,
  brighteningSun: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2" />
    </Icon>
  ),
  snowball: (
    <Icon>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 3 4-3M8 20l4-3 4 3" />
    </Icon>
  ),
  cradle: LAYER_ICONS.life,
  terraformMars: TOOL_ICONS.biomeFactory,
  stoneAge: LAYER_ICONS.civilization,
  cambrian: LAYER_ICONS.diversity,
};

export const START_ICONS: Record<PlanetStart, ReactNode> = {
  young: TOOL_ICONS.volcano,
  microbial: (
    <Icon>
      <circle cx="12" cy="12" r="7" />
      <path d="M8 9h.1M15 8h.1M9 15c2 1 4 1 6-1" />
    </Icon>
  ),
  quick: (
    <Icon>
      <path d="M13 2 5 14h7l-1 8 8-12h-7Z" />
    </Icon>
  ),
};

export type FloatingWindowId = ControlGroupId | 'civilization' | 'planet';

export const WINDOW_ICONS: Record<FloatingWindowId, ReactNode> = {
  geosphere: LAYER_ICONS.plates,
  atmosphere: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M4 9c4-2 7 2 11 0s5 1 6 2M3 14c4-2 7 2 11 0s5 1 6 2" />
    </Icon>
  ),
  biosphere: LAYER_ICONS.life,
  civilization: LAYER_ICONS.civilization,
  planet: VIEW_ICONS.globe,
};

export const MAP_ICONS = {
  zoomIn: (
    <Icon>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M10.5 7.5v6m-3-3h6" />
    </Icon>
  ),
  zoomOut: (
    <Icon>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5M7.5 10.5h6" />
    </Icon>
  ),
  zoomReset: (
    <Icon>
      <path d="M4 9V4h5m6 0h5v5m0 6v5h-5m-6 0H4v-5" />
    </Icon>
  ),
  minimap: (
    <Icon>
      <rect x="2" y="5" width="20" height="14" rx="1" />
      <rect x="12" y="12" width="7" height="4.5" />
    </Icon>
  ),
} satisfies Record<string, ReactNode>;

/** Map capture and time-lapse actions. */
export const EXPORT_ICONS = {
  image: (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="2" />
      <path d="m5 17 5-5 3 3 2-2 4 4" />
    </Icon>
  ),
  record: (
    <Icon>
      <circle cx="12" cy="12" r="7" fill="currentColor" stroke="none" />
    </Icon>
  ),
  stop: (
    <Icon>
      <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" />
    </Icon>
  ),
  video: (
    <Icon>
      <rect x="3" y="6" width="13" height="12" rx="2" />
      <path d="m16 10 5-3v10l-5-3" />
    </Icon>
  ),
} satisfies Record<string, ReactNode>;

export const DICE_ICON = (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="3" />
    <circle cx="8" cy="8" r="1" fill="currentColor" />
    <circle cx="16" cy="8" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="8" cy="16" r="1" fill="currentColor" />
    <circle cx="16" cy="16" r="1" fill="currentColor" />
  </Icon>
);

/** Scenario objective marker used by the Goal tab and outcome dialog. */
export const GOAL_ICON = (
  <Icon>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="5" />
    <circle cx="12" cy="12" r="1.5" fill="currentColor" />
    <path d="m14 10 6-6m-3 0h3v3" />
  </Icon>
);

/** Compact measure glyphs used beside history-chart titles and picker labels. */
export const CHART_ICONS: Record<string, ReactNode> = {
  meanTemperature: LAYER_ICONS.airTemperature,
  runawayMargin: (
    <Icon>
      <path d="M4 19 12 3l8 16M8 14h8" />
      <path d="M12 8v3m0 4v.5" />
    </Icon>
  ),
  co2: TOOL_ICONS.addCo2,
  co2Ice: LAYER_ICONS.clathrates,
  surfacePressure: LAYER_ICONS.pressure,
  water: LAYER_ICONS.precipitation,
  iceFraction: (
    <Icon>
      <path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M8 4l4 3 4-3M8 20l4-3 4 3" />
    </Icon>
  ),
  landFraction: LAYER_ICONS.terrain,
  seaLevel: LAYER_ICONS.oceanCurrents,
  solarInput: (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2m0-14-2 2M7 17l-2 2" />
    </Icon>
  ),
  o2: LAYER_ICONS.oceanOxygen,
  ch4: LAYER_ICONS.clathrates,
  livingClasses: LAYER_ICONS.life,
  biodiversity: LAYER_ICONS.diversity,
  dust: DISASTER_ICONS.dustStorms,
  oceanAcidity: (
    <Icon>
      <path d="M4 18c4-3 12-3 16 0M6 11h5m-2.5-2.5v5M15 9h5" />
      <path d="M12 3s-7 8-7 12a7 7 0 0 0 14 0c0-4-7-12-7-12Z" />
    </Icon>
  ),
  meanOceanOxygen: LAYER_ICONS.oceanOxygen,
  clathrateMethane: LAYER_ICONS.clathrates,
  fossilCarbon: (
    <Icon>
      <path d="M4 20h16M6 20v-6l6-10 6 10v6M9 14h6M10 17h4" />
    </Icon>
  ),
  population: LAYER_ICONS.civilization,
  pollution: DISASTER_ICONS.dustStorms,
  forestFraction: LAYER_ICONS.biomes,
  desertFraction: DISASTER_ICONS.droughts,
  whiteDaisies: LAYER_ICONS.daisies,
  blackDaisies: LAYER_ICONS.daisies,
};
