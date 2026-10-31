import type { TECH_AGES } from '../sim/data/civilization';
import type { LifeClassKey } from '../sim/data/lifeClasses';
import type { EventKey } from '../sim/events';
import type { DeviceKind } from '../sim/tools/devices';
import type { PaletteMode } from './accessibilitySettings';

export const PIXEL_ICON_SIZE = 16;
export const PIXEL_ICON_SYMBOLS = '.osbla' as const;

export type PixelIconRows = readonly string[];
export type PixelIconPalette = readonly [string, string, string, string, string, string];

interface PixelIconTheme {
  /** Transparent, outline, shade, body, light and accent. */
  readonly palette: PixelIconPalette;
  readonly colourBlindPalette: PixelIconPalette;
}

export interface PixelIconDefinition extends PixelIconTheme {
  readonly rows: PixelIconRows;
}

const TRANSPARENT = 'rgba(0,0,0,0)';

// These compact palettes reuse hues from the terrain sprites and quantitative
// map palettes, with a darker common outline so symbols survive every surface.
const THEMES = {
  microbe: theme(
    ['#123651', '#2a8290', '#67c7c2', '#c7f3df'],
    ['#25334a', '#4477aa', '#66ccee', '#eecc66'],
  ),
  plant: theme(
    ['#163d27', '#248745', '#7fc65c', '#e1e67a'],
    ['#263b45', '#228833', '#ccbb44', '#eecc66'],
  ),
  radiate: theme(
    ['#6b284b', '#d45178', '#ff8aaa', '#ffe69a'],
    ['#352f4a', '#aa3377', '#ee6677', '#eecc66'],
  ),
  arthropod: theme(
    ['#612b20', '#b84c2f', '#ed7b45', '#ffd07a'],
    ['#3b3345', '#cc3311', '#ee7733', '#eecc66'],
  ),
  mollusk: theme(
    ['#402759', '#7d54a5', '#c58ee6', '#f3d1ff'],
    ['#30304d', '#aa3377', '#cc78bc', '#66ccee'],
  ),
  trichordate: theme(
    ['#174c57', '#298e93', '#69d5c5', '#d8fff0'],
    ['#29384d', '#0077bb', '#66ccee', '#eecc66'],
  ),
  fish: theme(
    ['#113f75', '#287ec0', '#66b9ed', '#f5d76e'],
    ['#25334a', '#4477aa', '#66ccee', '#eecc66'],
  ),
  insect: theme(
    ['#4d3515', '#b77a10', '#f3c539', '#fff3a3'],
    ['#40362d', '#ee7733', '#ccbb44', '#eeeeee'],
  ),
  amphibian: theme(
    ['#174d27', '#2d9a45', '#70df58', '#e8f477'],
    ['#263b45', '#228833', '#ccbb44', '#66ccee'],
  ),
  reptile: theme(
    ['#294b38', '#477b52', '#85a84d', '#d8d66a'],
    ['#29384d', '#0077bb', '#66ccee', '#eecc66'],
  ),
  dinosaur: theme(
    ['#432c63', '#7650a8', '#b880da', '#f0d08a'],
    ['#312f5c', '#aa3377', '#66ccee', '#eecc66'],
  ),
  avian: theme(
    ['#244c72', '#4a9bd0', '#9fdcff', '#ffffff'],
    ['#29384d', '#4477aa', '#66ccee', '#eeeeee'],
  ),
  mammal: theme(
    ['#4a3024', '#8a5738', '#cb8d57', '#f0c889'],
    ['#40362d', '#996633', '#ddaa33', '#eeeeee'],
  ),
  cetacean: theme(
    ['#193c5a', '#3e7190', '#86bdd0', '#d8f2f2'],
    ['#29384d', '#4477aa', '#66ccee', '#eeeeee'],
  ),
  city: theme(
    ['#6c421f', '#d58b32', '#ffd45f', '#fff2ad'],
    ['#43384b', '#ee9933', '#ccbb44', '#66ccee'],
  ),
  ruin: theme(
    ['#39373a', '#746b64', '#aaa094', '#d8d0c2'],
    ['#343c46', '#666666', '#aaaaaa', '#dddddd'],
  ),
  deviceWarm: theme(
    ['#572923', '#c45235', '#f2a541', '#fff09a'],
    ['#3b3345', '#ee7733', '#eecc66', '#66ccee'],
  ),
  deviceCool: theme(
    ['#193b61', '#397fc5', '#7be0d6', '#e2ffff'],
    ['#28374e', '#4477aa', '#66ccee', '#eeeeee'],
  ),
  co2Machine: theme(
    ['#4b3634', '#b5482d', '#ef8738', '#a9a49d'],
    ['#3b3345', '#cc3311', '#ee7733', '#bbbbbb'],
  ),
  n2Machine: theme(
    ['#344557', '#6f8fa8', '#b9d1df', '#f1f4e8'],
    ['#29384d', '#4477aa', '#66ccee', '#eeeeee'],
  ),
  o2Machine: theme(
    ['#174867', '#287eb0', '#68ccea', '#d8fbff'],
    ['#29384d', '#0077bb', '#66ccee', '#eeeeee'],
  ),
  scrubber: theme(
    ['#384246', '#697d7d', '#a9c0b4', '#e6ead6'],
    ['#343c46', '#666666', '#aaaaaa', '#eecc66'],
  ),
  greenhouse: theme(
    ['#174d27', '#2d9a45', '#7bd5d6', '#e8f477'],
    ['#263b45', '#228833', '#66ccee', '#eecc66'],
  ),
  geology: theme(
    ['#4b2730', '#b4392b', '#f1892b', '#ffeb84'],
    ['#35303e', '#aa3377', '#ee9933', '#eecc66'],
  ),
  climate: theme(
    ['#173c66', '#3998c2', '#9de4ff', '#ffffff'],
    ['#29384d', '#4477aa', '#66ccee', '#eeeeee'],
  ),
  danger: theme(
    ['#5a1f2a', '#c8323f', '#ff7777', '#ffe08a'],
    ['#3d3046', '#aa3377', '#ee6677', '#eecc66'],
  ),
  goal: theme(
    ['#45306f', '#8f62c7', '#d7c0ff', '#fff09a'],
    ['#312f5c', '#aa3377', '#66ccee', '#eecc66'],
  ),
} as const;

function theme(
  normal: readonly [string, string, string, string],
  colourBlind: readonly [string, string, string, string],
): PixelIconTheme {
  return {
    palette: [TRANSPARENT, '#10141b', ...normal],
    colourBlindPalette: [TRANSPARENT, '#111820', ...colourBlind],
  };
}

/**
 * Authors may describe the coloured 14x14 interior compactly. The returned
 * grid is always 16x16 and receives an eight-neighbour, one-pixel dark outline.
 */
function shape(...source: string[]): PixelIconRows {
  const trimmed = source.map((row) => row.replace(/\.+$/u, ''));
  if (trimmed.length > 14 || trimmed.some((row) => row.length > 14 || /[^.sbla]/u.test(row))) {
    throw new Error('Pixel icon silhouettes must fit the 14 by 14 interior');
  }
  const interior = Array.from({ length: 14 }, () => '.'.repeat(14).split(''));
  const top = Math.floor((14 - trimmed.length) / 2);
  for (let y = 0; y < trimmed.length; y++) {
    const row = trimmed[y]!;
    for (let x = 0; x < row.length; x++) interior[top + y]![x] = row[x]!;
  }
  const grid = Array.from({ length: PIXEL_ICON_SIZE }, () => '.'.repeat(PIXEL_ICON_SIZE).split(''));
  for (let y = 0; y < 14; y++) {
    for (let x = 0; x < 14; x++) grid[y + 1]![x + 1] = interior[y]![x]!;
  }
  for (let y = 1; y < PIXEL_ICON_SIZE - 1; y++) {
    for (let x = 1; x < PIXEL_ICON_SIZE - 1; x++) {
      if (grid[y]![x] === '.' || grid[y]![x] === 'o') continue;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (grid[y + oy]![x + ox] === '.') grid[y + oy]![x + ox] = 'o';
        }
      }
    }
  }
  return grid.map((row) => row.join(''));
}

function icon(themeValue: PixelIconTheme, ...source: string[]): PixelIconDefinition {
  return { ...themeValue, rows: shape(...source) };
}

// Original silhouettes drawn specifically for Geogenesis. They favour strong
// profiles and one bright detail, because their real test size is sixteen pixels.
export const PIXEL_ICONS = {
  lifeProkaryotes: icon(
    THEMES.microbe,
    '....bbb.......',
    '..bbllbb...a...',
    '.blbbbbl..aaa..',
    '.blbasbl...a...',
    '..bbssb........',
    '....bb.........',
  ),
  lifeEukaryotes: icon(
    THEMES.microbe,
    '...bbbbbb......',
    '..blllllbb.....',
    '.blbssbbblb....',
    '.blsaaasblb....',
    '.blsaaasblb....',
    '.blbbssbblb....',
    '..bbllllbb.....',
    '...bbbbbb......',
  ),
  lifePlants: icon(
    THEMES.plant,
    '......ll.......',
    '.....llb..lll..',
    '..lllbbb.lllb..',
    '.lllbblbllbb...',
    '.lbbbblbbbb....',
    '..bbblbbb......',
    '....bbb........',
    '.....b.........',
    '.....b.........',
    '....sbs........',
    '...sssss.......',
  ),
  lifeRadiates: icon(
    THEMES.radiate,
    '....bbbbbb....',
    '...bllllllb...',
    '..bllallallb..',
    '..bllllllllb..',
    '...bssssssb...',
    '....bbbbbb....',
    '...b..b.b..b..',
    '..b...b.b...b.',
    '.b....b.b....b',
  ),
  lifeArthropods: icon(
    THEMES.arthropod,
    'b...........b.',
    'bb...b.b...bb.',
    '.bb.bbbbbbb.bb',
    '..bbllalllbb..',
    '...bllllllb...',
    '..bblslslsbb..',
    '.b.bbbbbbbb.b.',
    'b.b.b....b.b.b',
    '.b.b......b.b.',
  ),
  lifeMollusks: icon(
    THEMES.mollusk,
    '.....bb.......',
    '...bbllbb.....',
    '..bllalllb....',
    '.bllabblllb...',
    '.bllbssbllb...',
    '..bllllllb.....',
    '..bbbbbbbbbb..',
    '.sssbbbbllllb.',
    'ssssssbbbbbbb.',
    '..bbbbbbbb....',
  ),
  lifeTrichordates: icon(
    THEMES.trichordate,
    '....bb........',
    '...bllbb......',
    '..blllllbbb....',
    '.bllallllllb...',
    '..bllllllllbb..',
    '..bbssssllllb.',
    '.....bbbbbbllb.',
    '..........bbb.',
  ),
  lifeFish: icon(
    THEMES.fish,
    '..........b.b.',
    '.....bbbb.bbb.',
    '..bbbllllbbb...',
    '.bllllllllllb.',
    'bllalllllllllb',
    '.blllllllsssb.',
    '..bbbllllbbb...',
    '.....bbbb.bbb.',
    '..........b.b.',
  ),
  lifeInsects: icon(
    THEMES.insect,
    '...b......b...',
    '....b....b....',
    '.lllbbaabblll.',
    'bllllbllbllllb',
    '..bbbllllbbb..',
    'b.b..bbbb..b.b',
    '.b...bllb...b.',
    'b....bssb....b',
    '.....bbbb.....',
    '....b....b....',
  ),
  lifeAmphibians: icon(
    THEMES.amphibian,
    '...bb....bb...',
    '..bllb..bllb..',
    '...bbaabb.....',
    '.bbllllllbb...',
    'bllllllllllllb',
    'blllssllsslllb',
    '.bbllllllllbb.',
    '..bb......bb..',
    '.bbb......bbb.',
    'bb..........bb',
  ),
  lifeReptiles: icon(
    THEMES.reptile,
    '.bbb..........',
    'bllbbbbbbbb...',
    'bllallllllllbb',
    '.bblllllllbbb.',
    '...bbbbbbb..bb',
    '..bb..bb......',
    '.bb....bb.....',
    'b.......b.....',
  ),
  lifeDinosaurs: icon(
    THEMES.dinosaur,
    '..........bbb.',
    '..........blb.',
    '.........bllb.',
    '........blllb.',
    '..bbbbbbllllb.',
    'bblllllllllb..',
    '.bllallllllb..',
    '..bbllllllbb..',
    '....bllb......',
    '....b..b...bb.',
    '...bb..bb..bb.',
  ),
  lifeAvians: icon(
    THEMES.avian,
    '......a.......',
    '.....blb......',
    'b....blb....b.',
    'lb..blllb..bl.',
    'llbblllllbblll',
    'bllllllllllllb',
    '.bbllllllllbb.',
    '...bbllllbb...',
    '.....bllb.....',
    '....b....b....',
  ),
  lifeMammals: icon(
    THEMES.mammal,
    '...........bb.',
    '..bb......bllb',
    '..blbbbbbblllb',
    'bbllllllllllbb',
    '.bllallllllb..',
    '..bllssssllb..',
    '..bbb....bbb..',
    '..b.b....b.b..',
    '.bb.bb..bb.bb.',
  ),
  lifeCetaceans: icon(
    THEMES.cetacean,
    '...a..........',
    '..a.a.........',
    '...b..........',
    '.bbbbbbbb.....',
    'bllllllllbbb..',
    'bllallllllllbb',
    '.bllllllsssbb.',
    '..bbbbbbbb..b.',
    '..........b..b',
    '...........bb.',
  ),

  cityStone: icon(
    THEMES.city,
    '......ll.......',
    '.....lbbb......',
    '....lbbbb......',
    '...lbbbbbb.....',
    '..lbbbbbbbb....',
    '..bllbllblb....',
    '..bssb..bsb....',
    '..bbbb..bbb....',
  ),
  cityBronze: icon(
    THEMES.city,
    '...aaaaaaaa....',
    '..abbbbbbbba...',
    '...bllbllbb....',
    '...bllbllbb....',
    '...bssbssbb....',
    '...bssbssbb....',
    '..bbbbbbbbbb...',
  ),
  cityIron: icon(
    THEMES.city,
    '..bb..bb..bb...',
    '..blb.blb.blb..',
    '..bllbbllbbllb.',
    '..bllllllllllb.',
    '..bssbssssbssb.',
    '..bssb....bssb.',
    '..bbbb....bbbb.',
  ),
  cityIndustrial: icon(
    THEMES.city,
    '..........bb...',
    '..........lb...',
    '..bb......lb...',
    '..bl..bb..lb...',
    '..bl..bl..lb...',
    '..blb.blb.lbb..',
    '..bllbbllbllb..',
    '..bssbsssbssb..',
    '..bbbbbbbbbbb..',
  ),
  cityAtomic: icon(
    THEMES.city,
    '......a........',
    '...a..b..a.....',
    '....blllb......',
    '..abllallba....',
    '...bllsllb.....',
    '.bbblsasblbbb..',
    '...bllsllb.....',
    '..abllallba....',
    '....blllb......',
    '...a..b..a.....',
    '......a........',
  ),
  cityInformation: icon(
    THEMES.city,
    '.....aaa.......',
    '....a.b.a......',
    '..a...b...a....',
    '.....blb.......',
    '....blllb......',
    '....blllb......',
    '...bllsllb.....',
    '...bllsllb.....',
    '..bbbbbbbbb....',
  ),
  cityNanotech: icon(
    THEMES.city,
    '......a........',
    '...a..a..a.....',
    '....bbbbb......',
    '..bblllllbb....',
    '.bllllallllb...',
    'bllllbbbllllb..',
    'blllb...blllb..',
    'bbbb.....bbbb..',
  ),
  cityCapital: icon(
    THEMES.city,
    '.....a.........',
    '.....ab........',
    '..aaaab........',
    '..allllbbbb....',
    '..aaaabllllb...',
    '.....ablllbb...',
    '....bllllb.....',
    '...bllalllb....',
    '..bllssssllb...',
    '..bbbbbbbbbb...',
  ),
  cityRuins: icon(
    THEMES.ruin,
    '..bb.......b...',
    '..blb.....bb...',
    '..bllbb..blb...',
    '..bsslb.bllb...',
    '..bsssbblssb...',
    '..bbbssbsssb...',
    '....bsssssbb...',
    '...bbbbbbbb....',
  ),

  deviceCo2Generator: icon(
    THEMES.co2Machine,
    '.........aaa..',
    '........aaaaa.',
    '..bb.....aaa..',
    '..bl......a...',
    '..blb.........',
    '..blb..b.b.b..',
    '..bllbblllllb.',
    '..bllbllasllb.',
    '..bssbssssssb.',
    '..bbbbbbbbbbb.',
  ),
  deviceN2Generator: icon(
    THEMES.n2Machine,
    '.........aaa..',
    '........aaaaa.',
    '.........aaa..',
    '...bbbb...b...',
    '..bllllb..bbb.',
    '..bllllbbbb...',
    '..bllallb.....',
    '..bssssb......',
    '..bssssb......',
    '...bbbb.......',
  ),
  deviceO2Generator: icon(
    THEMES.o2Machine,
    '..........a...',
    '.......a......',
    '.........a.a..',
    '..bbb..bbb....',
    '.blllb.blllb..',
    'bllalbllallb..',
    '.blllb.blllb..',
    '..bbb..bbb....',
    '..bssssssb....',
    '..bbbbbbbb....',
  ),
  deviceCo2Scrubber: icon(
    THEMES.scrubber,
    'aaa...bbbbbb..',
    'aaaaa..bllllb.',
    '.aaa....bllb..',
    '..a......bb...',
    '......bllllb..',
    '.....blslslb..',
    '.....bssssb...',
    '.....bssssb...',
    '.....bbbbbb...',
  ),
  deviceBiomeFactory: icon(
    THEMES.greenhouse,
    '.....llll.....',
    '...ll....ll...',
    '..l........l..',
    '.l....bb....l.',
    '.l...bbbb...l.',
    '.l..bllb....l.',
    '.l.bbbabb...l.',
    '.l...bb.....l.',
    'bbbbbbbbbbbbbb',
    '..ssssssssss..',
  ),

  eventLife: icon(
    THEMES.plant,
    '.....ll........',
    '..ll.llb.lll...',
    '.lbbllbblllb...',
    '..bbbblbbbb....',
    '....bbb........',
    '.....b.........',
    '.....b.........',
  ),
  eventClimate: icon(
    THEMES.climate,
    '.....bb........',
    '....bllb.......',
    '....bllb.......',
    '....bllb.......',
    '....bllb.......',
    '...bllllb......',
    '..bllalllb.....',
    '..bllllllb.....',
    '...bbbbbb......',
  ),
  eventGeology: icon(
    THEMES.geology,
    '......a........',
    '.....aba.......',
    '.....bbb.......',
    '....bllbb......',
    '...bllslbb.....',
    '..bllllsllb....',
    '.bllllsssllb...',
    'bbbbbbbbbbbbb..',
  ),
  eventCivilization: icon(
    THEMES.city,
    '..bb..bb..bb...',
    '..blb.blb.blb..',
    '..bllbbllbbllb.',
    '..bllllllllllb.',
    '..bssb....bssb.',
    '..bbbb....bbbb.',
  ),
  eventGoal: icon(
    THEMES.goal,
    '.....bbbb......',
    '...bbllllbb....',
    '..bllbbbbllb...',
    '.bllbllllbllb..',
    '.blbllbbllblb..',
    '.blbllbbllblb..',
    '.bllbllllbllb..',
    '..bllbbbbllb...',
    '...bbllllbb....',
    '.....bbbb......',
  ),
  eventImpactGroup: icon(
    THEMES.geology,
    '..........aa...',
    '........aal....',
    '......aalb.....',
    '....aalbb......',
    '..aalbb........',
    '.albb...sss....',
    '..bb..ssasss...',
    '.....ssasss....',
    '......sss......',
  ),
  eventDevice: icon(
    THEMES.deviceCool,
    '.....bb........',
    '....bllb.......',
    '..bbbllbbb.....',
    '.blllaalllb....',
    '.bllallallb....',
    '..bbbllbbb.....',
    '....bllb.......',
    '.....bb........',
  ),

  eventImpact: icon(
    THEMES.geology,
    '..........aa...',
    '........aal....',
    '......aalb.....',
    '....aalbb......',
    '..aalbb........',
    '.albb..sssss...',
    '..bb..ssaaass..',
    '.....saaaaas...',
    '.....ssaaass...',
    '......sssss....',
  ),
  eventEruption: icon(
    THEMES.geology,
    '....a.a.a......',
    '.....aaa.......',
    '....asasa......',
    '.....aba.......',
    '.....bbb.......',
    '....bllbb......',
    '...bllalbb.....',
    '..bllaaallb....',
    '.bbbssssssbbb..',
  ),
  eventPlague: icon(
    THEMES.danger,
    '.....bbb.......',
    '.....bab.......',
    '..bb.bbb.bb....',
    '..blbbllbllb...',
    '...bbllllbb....',
    '.bblllaalllbb..',
    '...bbllllbb....',
    '..bsbbllbbssb..',
    '..bb.bbbb.bb...',
  ),
  eventWar: icon(
    THEMES.danger,
    '..b.......b....',
    '...b.....b.....',
    '....b...b......',
    '.....b.b.......',
    '......b........',
    '.....blb.......',
    '....blllb......',
    '...bssassb.....',
    '..bsssasssb....',
  ),
  eventNuclearWar: icon(
    THEMES.danger,
    '......b........',
    '....bbabb......',
    '...bllallb.....',
    '..blblaalbb....',
    'bbllaabssllbb..',
    '..bssbaasbb....',
    '...bssassb.....',
    '..bsssasssb....',
    '.bbbbbbbbbbbb...',
  ),
  eventEarthquake: icon(
    THEMES.geology,
    '..b...bb..b....',
    '..lb.blb.bl....',
    '..llbb.bblb....',
    '..bbs...bll....',
    '....bb..bbb....',
    '.bb..blbb......',
    '.blbbbl.bbbb...',
    '.blllb..bllb...',
    '.bbbbb..bbbb...',
  ),
  eventTsunami: icon(
    THEMES.climate,
    '.......bbbb....',
    '.....bbllllb...',
    '....bllllllb...',
    '...bllllbb.....',
    '..bllllb.......',
    '.bllllb..bbb...',
    '.blllb.bblllb..',
    '..bbb.blllllb..',
    '.....bllbbb....',
    'bbbbbbbbbbbbbb.',
  ),
  eventCyclone: icon(
    THEMES.climate,
    '...bbbbbb......',
    '..bllllllbb....',
    '.bllbbbblllb...',
    '.blbb...blllb..',
    '.blb..a.blllb..',
    '.bllb...bbllb..',
    '..bllbbbbllb...',
    '...bbllllb.....',
    '.....bbbb......',
  ),
  eventExodus: icon(
    THEMES.goal,
    '.....bb........',
    '....bllb.......',
    '...bllllb......',
    '...bllalb......',
    '...bllllb......',
    '..bllssllb.....',
    '..bllssllb.....',
    '.bbblssllbbb...',
    '...bssssb......',
    '..b..ss..b.....',
  ),
  eventExtinction: icon(
    THEMES.danger,
    '..bb......bb...',
    '...bb....bb....',
    '....bb..bb.....',
    '.....bbbb......',
    '......bb.......',
    '.....bbbb......',
    '....bb..bb.....',
    '...bb....bb....',
    '..bb......bb...',
  ),
  eventSentience: icon(
    THEMES.goal,
    '....bbbbbb.....',
    '...bllllllb....',
    '..bllabblllb...',
    '..bllbbblllb...',
    '...bllllllb....',
    '....bllllb.....',
    '....bllllb.....',
    '...bbbbbbbb....',
  ),
  eventPollution: icon(
    THEMES.danger,
    '......ss.......',
    '....ssass......',
    '...saaaaas.....',
    '..ssaaaaass....',
    '....bbbb.......',
    '...bllllb......',
    '..bssssssb.....',
    '..bbbbbbbb.....',
  ),
  eventCollapse: icon(
    THEMES.ruin,
    '..b.......bb...',
    '..lb....bllb...',
    '..llb..blllb...',
    '..bslbbllssb...',
    '..bsssbbsssb...',
    '..bbbssbsssb...',
    '....bssssbb....',
    '..bbbbbbbbbb...',
  ),
  eventMeteor: icon(
    THEMES.geology,
    '..........aa...',
    '........aal....',
    '......aalb.....',
    '....aalbb......',
    '..aalbb........',
    '.albb...........',
    '..bb..bbbb.....',
    '.....bllllb....',
    '.....bllalb....',
    '......bbbb.....',
  ),
  eventLip: icon(
    THEMES.geology,
    '.....a.........',
    '....aaa........',
    '..a.a.a.a......',
    '...ababa.......',
    '...bbbbb.......',
    '..bllbllb......',
    '.bllsssssbb....',
    'bbbbbbbbbbbbb..',
  ),
  eventOceanLost: icon(
    THEMES.climate,
    '.....bb........',
    '....bllb.......',
    '...bllllb......',
    '..bllllllb.....',
    '..bllllllb.....',
    '..bllbbllb.....',
    '...bb..bb......',
    '.bbbbbbbbbbbb..',
  ),
  eventMagnetic: icon(
    THEMES.climate,
    '..bb......bb...',
    '..blb....blb...',
    '..blb....blb...',
    '..blb....blb...',
    '..blb....blb...',
    '...blbbbbllb...',
    '....bbllbb.....',
    '.....bbbb......',
  ),
  eventAtmosphere: icon(
    THEMES.climate,
    '..bbbbbb.......',
    '.bllllllbbb....',
    '..bbbblllllb...',
    '......bbbbbb...',
    '..bbbbbb.......',
    '.bllllllbbbb...',
    '..bbbbllllllb..',
    '......bbbbbb...',
  ),
  eventMonolith: icon(
    THEMES.goal,
    '.....bbbb......',
    '.....bllb......',
    '.....bllb......',
    '.....bllb......',
    '.....bllb......',
    '.....bllb......',
    '.....bssb......',
    '.....bssb......',
    '...bbbbbbbb....',
  ),
  eventIceMeteor: icon(
    THEMES.climate,
    '..........ll...',
    '........llb....',
    '......llbb.....',
    '....llbb.......',
    '..llbb..........',
    '.lbb...b.b......',
    '..bb..bbbbb.....',
    '.....blllb.....',
    '....bllallb....',
    '.....bbbbb.....',
  ),
  eventDrought: icon(
    THEMES.deviceWarm,
    '..........a....',
    '.........aaa...',
    '..b...b....a...',
    '...b.b.........',
    '....b...b......',
    '..b..b.b.......',
    '...b..b........',
    '.bbbbbbbbbbbb..',
  ),
  eventWarning: icon(
    THEMES.danger,
    '......b........',
    '.....blb.......',
    '....blllb......',
    '...blllllb.....',
    '..blllalssb....',
    '.bllllalsssb...',
    'bsssssalssssb..',
    'bbbbbbbbbbbbb..',
  ),
  eventGoalLost: icon(
    THEMES.danger,
    '.....bbbb......',
    '...bbllllbb....',
    '..bllbbbbllb...',
    '.bllbllllbllb..',
    '.blbblbbllblb..',
    '.blbllbbblblb..',
    '.bllbllllbllb..',
    '..bllbbbbllb...',
    '...bbllllbb....',
    '.....bbbb......',
  ),
} as const satisfies Record<string, PixelIconDefinition>;

export type PixelIconKey = keyof typeof PIXEL_ICONS;
export const PIXEL_ICON_KEYS = Object.keys(PIXEL_ICONS) as PixelIconKey[];
const PIXEL_ICON_INDEX = Object.fromEntries(
  PIXEL_ICON_KEYS.map((key, index) => [key, index]),
) as Record<PixelIconKey, number>;

export const LIFE_PIXEL_ICONS = {
  prokaryotes: 'lifeProkaryotes',
  eukaryotes: 'lifeEukaryotes',
  plants: 'lifePlants',
  radiates: 'lifeRadiates',
  arthropods: 'lifeArthropods',
  mollusks: 'lifeMollusks',
  trichordates: 'lifeTrichordates',
  fish: 'lifeFish',
  insects: 'lifeInsects',
  amphibians: 'lifeAmphibians',
  reptiles: 'lifeReptiles',
  dinosaurs: 'lifeDinosaurs',
  avians: 'lifeAvians',
  mammals: 'lifeMammals',
  cetaceans: 'lifeCetaceans',
} as const satisfies Record<LifeClassKey, PixelIconKey>;

export const CITY_PIXEL_ICONS = {
  stone: 'cityStone',
  bronze: 'cityBronze',
  iron: 'cityIron',
  industrial: 'cityIndustrial',
  atomic: 'cityAtomic',
  information: 'cityInformation',
  nanotech: 'cityNanotech',
} as const satisfies Record<(typeof TECH_AGES)[number]['key'], PixelIconKey>;

export const CAPITAL_PIXEL_ICON: PixelIconKey = 'cityCapital';
export const RUINS_PIXEL_ICON: PixelIconKey = 'cityRuins';

export const DEVICE_PIXEL_ICONS = {
  co2Generator: 'deviceCo2Generator',
  n2Generator: 'deviceN2Generator',
  o2Generator: 'deviceO2Generator',
  co2Scrubber: 'deviceCo2Scrubber',
  biomeFactory: 'deviceBiomeFactory',
} as const satisfies Record<DeviceKind, PixelIconKey>;

export const EVENT_GROUP_PIXEL_ICONS = {
  geology: 'eventGeology',
  climate: 'eventClimate',
  life: 'eventLife',
  civilization: 'eventCivilization',
  goal: 'eventGoal',
  impacts: 'eventImpactGroup',
  device: 'eventDevice',
} as const satisfies Record<string, PixelIconKey>;

export const EVENT_PIXEL_ICONS = {
  lifeOrigin: 'lifeProkaryotes',
  impact: 'eventImpact',
  classAppeared: 'eventLife',
  classExtinct: 'eventExtinction',
  massExtinction: 'eventExtinction',
  cambrianExplosion: 'lifeRadiates',
  sentience: 'eventSentience',
  ageReached: 'eventCivilization',
  plague: 'eventPlague',
  nuclearWar: 'eventNuclearWar',
  fossilFuelsRunningOut: 'eventCivilization',
  energyTransition: 'eventCivilization',
  pollutionCrisis: 'eventPollution',
  civilizationCollapsed: 'eventCollapse',
  exodusPopulationTooLow: 'eventCivilization',
  exodus: 'eventExodus',
  meteor: 'eventMeteor',
  largeEruption: 'eventEruption',
  largeIgneousProvince: 'eventLip',
  runawayGreenhouse: 'eventClimate',
  runawayWarning: 'eventWarning',
  runawayEnded: 'eventClimate',
  oceansLost: 'eventOceanLost',
  magneticFieldLost: 'eventMagnetic',
  stagnantLid: 'eventGeology',
  atmosphereLost: 'eventAtmosphere',
  methaneRelease: 'eventClimate',
  monolith: 'eventMonolith',
  eraReached: 'eventCivilization',
  goalWon: 'eventGoal',
  goalLost: 'eventGoalLost',
  deviceDestroyed: 'eventDevice',
  iceMeteor: 'eventIceMeteor',
  earthquake: 'eventEarthquake',
  tsunami: 'eventTsunami',
  cyclone: 'eventCyclone',
  drought: 'eventDrought',
  greatOxidation: 'eventLife',
  snowballOnset: 'eventClimate',
  snowballEnded: 'eventClimate',
  trendRunaway: 'eventClimate',
  trendSnowball: 'eventClimate',
  trendCo2Starvation: 'eventLife',
  trendOxygenLoss: 'eventLife',
  trendBiodiversityLoss: 'eventLife',
  trendFossilLow: 'eventCivilization',
  trendPollution: 'eventPollution',
  disasterWarning: 'eventWarning',
} as const satisfies Record<EventKey, PixelIconKey>;

export function pixelIconPalette(key: PixelIconKey, mode: PaletteMode): PixelIconPalette {
  const iconValue = PIXEL_ICONS[key];
  return mode === 'colourBlind' ? iconValue.colourBlindPalette : iconValue.palette;
}

export function pixelIconScale(size: number): 1 | 2 | 3 {
  if (size >= 38) return 3;
  if (size >= 23) return 2;
  return 1;
}

export class PixelIconCache<T> {
  private readonly values = new Map<number, T>();

  public get size(): number {
    return this.values.size;
  }

  public get(key: PixelIconKey, scale: 1 | 2 | 3, mode: PaletteMode, create: () => T): T {
    const cacheKey = this.cacheKey(key, scale, mode);
    const cached = this.values.get(cacheKey);
    if (cached !== undefined) return cached;
    const value = create();
    this.values.set(cacheKey, value);
    return value;
  }

  public peek(key: PixelIconKey, scale: 1 | 2 | 3, mode: PaletteMode): T | undefined {
    return this.values.get(this.cacheKey(key, scale, mode));
  }

  public set(key: PixelIconKey, scale: 1 | 2 | 3, mode: PaletteMode, value: T): void {
    this.values.set(this.cacheKey(key, scale, mode), value);
  }

  private cacheKey(key: PixelIconKey, scale: 1 | 2 | 3, mode: PaletteMode): number {
    return (PIXEL_ICON_INDEX[key] * 3 + scale - 1) * 2 + Number(mode === 'colourBlind');
  }
}

const canvasCache = new PixelIconCache<HTMLCanvasElement>();
const SYMBOL_INDEX: Readonly<Record<string, number>> = { '.': 0, o: 1, s: 2, b: 3, l: 4, a: 5 };

/** Paints an icon only on cache misses and in previews. */
export function paintPixelIcon(
  ctx: CanvasRenderingContext2D,
  key: PixelIconKey,
  scale: 1 | 2 | 3,
  mode: PaletteMode,
): void {
  const definition = PIXEL_ICONS[key];
  const palette = pixelIconPalette(key, mode);
  let previous = '';
  for (let y = 0; y < PIXEL_ICON_SIZE; y++) {
    const row = definition.rows[y]!;
    for (let x = 0; x < PIXEL_ICON_SIZE; x++) {
      const color = palette[SYMBOL_INDEX[row[x]!]!]!;
      if (color === TRANSPARENT) continue;
      if (color !== previous) {
        ctx.fillStyle = color;
        previous = color;
      }
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
}

function cachedCanvas(key: PixelIconKey, scale: 1 | 2 | 3, mode: PaletteMode): HTMLCanvasElement {
  const cached = canvasCache.peek(key, scale, mode);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = PIXEL_ICON_SIZE * scale;
  canvas.height = PIXEL_ICON_SIZE * scale;
  const context = canvas.getContext('2d');
  if (context) {
    context.imageSmoothingEnabled = false;
    paintPixelIcon(context, key, scale, mode);
  }
  canvasCache.set(key, scale, mode, canvas);
  return canvas;
}

/** Draws a cached sprite centred on an integer screen pixel. */
export function drawPixelIcon(
  ctx: CanvasRenderingContext2D,
  key: PixelIconKey,
  x: number,
  y: number,
  size: number,
  mode: PaletteMode,
  alpha = 1,
): number {
  const scale = pixelIconScale(size);
  const pixels = PIXEL_ICON_SIZE * scale;
  const canvas = cachedCanvas(key, scale, mode);
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(canvas, Math.round(x - pixels / 2), Math.round(y - pixels / 2));
  ctx.restore();
  return pixels;
}
