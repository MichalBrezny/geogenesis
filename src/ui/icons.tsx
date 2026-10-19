import type { ReactNode } from 'react';
import type { MapLayer } from '../render/mapRenderer';
import type { ToolId } from '../sim/tools/tools';
import type { Overlay, View } from './PlanetView';
import type { ControlGroupId } from './ControlsPanel';

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

const MOUNTAIN = 'M2 20 8 10l4 6 3-4 7 8Z';
const CLOUD = 'M7 18h10a4 4 0 0 0 .6-7.95A5.5 5.5 0 0 0 7.1 9.5 4.25 4.25 0 0 0 7 18Z';

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
};

export const LAYER_ICONS: Record<MapLayer, ReactNode> = {
  terrain: (
    <Icon>
      <path d={MOUNTAIN} />
      <path d="m6.5 12.5 1.5 1 1.5-1" />
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
  daisies: (
    <Icon>
      <circle cx="12" cy="12" r="2.5" />
      <path d="M12 9.5a3 3 0 1 1 0-6 3 3 0 1 1 0 6Zm0 5a3 3 0 1 1 0 6 3 3 0 1 1 0-6Zm-2.5-2.5a3 3 0 1 1-6 0 3 3 0 1 1 6 0Zm5 0a3 3 0 1 1 6 0 3 3 0 1 1-6 0Z" />
    </Icon>
  ),
};

export const OVERLAY_ICONS: Record<Overlay, ReactNode> = {
  wind: LAYER_ICONS.wind,
  currents: LAYER_ICONS.oceanCurrents,
  isobars: LAYER_ICONS.pressure,
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

export type FloatingWindowId = ControlGroupId | 'planet';

export const WINDOW_ICONS: Record<FloatingWindowId, ReactNode> = {
  geosphere: LAYER_ICONS.plates,
  atmosphere: (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M4 9c4-2 7 2 11 0s5 1 6 2M3 14c4-2 7 2 11 0s5 1 6 2" />
    </Icon>
  ),
  biosphere: LAYER_ICONS.life,
  planet: VIEW_ICONS.globe,
};
