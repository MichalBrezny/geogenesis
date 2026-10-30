import type { PaletteMode } from './accessibilitySettings';

export const TILE_LOGICAL_SIZE = 16;

/** The original tile vocabulary used by the zoomed flat map. */
export const enum TerrainPattern {
  DeepOcean,
  ShallowOcean,
  Abyss,
  Shelf,
  FreshLake,
  SaltLake,
  SaltFlat,
  Ice,
  Tundra,
  BorealForest,
  TemperateForest,
  Grassland,
  Desert,
  Savanna,
  Rainforest,
  Swamp,
  Mountain,
  SnowMountain,
  Rock,
  Lava,
  Count,
}

export const TERRAIN_PATTERN_NAMES: readonly string[] = [
  'Deep ocean',
  'Shallow ocean',
  'Abyss',
  'Shelf',
  'Fresh lake',
  'Salt lake',
  'Salt flat',
  'Ice',
  'Tundra',
  'Boreal forest',
  'Temperate forest',
  'Grassland',
  'Desert',
  'Savanna',
  'Rainforest',
  'Swamp',
  'Mountain',
  'Snow mountain',
  'Rock',
  'Lava',
];

/** Runtime ids for previews and diagnostics (the enum itself is compile-time only). */
export const TERRAIN_PATTERN_IDS: readonly TerrainPattern[] = [
  TerrainPattern.DeepOcean,
  TerrainPattern.ShallowOcean,
  TerrainPattern.Abyss,
  TerrainPattern.Shelf,
  TerrainPattern.FreshLake,
  TerrainPattern.SaltLake,
  TerrainPattern.SaltFlat,
  TerrainPattern.Ice,
  TerrainPattern.Tundra,
  TerrainPattern.BorealForest,
  TerrainPattern.TemperateForest,
  TerrainPattern.Grassland,
  TerrainPattern.Desert,
  TerrainPattern.Savanna,
  TerrainPattern.Rainforest,
  TerrainPattern.Swamp,
  TerrainPattern.Mountain,
  TerrainPattern.SnowMountain,
  TerrainPattern.Rock,
  TerrainPattern.Lava,
];

type SpriteRows = readonly string[];
type SpritePalette = readonly [string, string, string, string, string];

export interface TerrainSpriteSet {
  /** Background, outline, body, highlight and accent. */
  readonly palette: SpritePalette;
  readonly colourBlindPalette: SpritePalette;
  readonly variants: readonly SpriteRows[];
}

const rows = (...value: string[]): SpriteRows => {
  if (value.length !== TILE_LOGICAL_SIZE || value.some((row) => row.length !== TILE_LOGICAL_SIZE)) {
    throw new Error('Terrain sprites must be exactly 16 by 16 characters');
  }
  // Early drafts used a dark one-pixel frame around every sprite. Strip that
  // legacy perimeter centrally so cached tiles share an uninterrupted ground.
  return value.map((row, y) =>
    y === 0 || y === TILE_LOGICAL_SIZE - 1
      ? '.'.repeat(TILE_LOGICAL_SIZE)
      : `.${row.slice(1, -1)}.`,
  );
};

const mirror = (source: SpriteRows): SpriteRows => source.map((row) => [...row].reverse().join(''));

const shift = (source: SpriteRows, amount: number): SpriteRows =>
  source.map((row) => {
    const interior = row.slice(1, -1);
    const offset = amount % interior.length;
    return row[0]! + interior.slice(-offset) + interior.slice(0, -offset) + row.at(-1)!;
  });

const paired = (source: SpriteRows, second?: SpriteRows): readonly SpriteRows[] => [
  source,
  second ?? mirror(source),
];

const animated = (source: SpriteRows): readonly SpriteRows[] => [
  source,
  shift(source, 1),
  shift(source, 2),
  shift(source, 3),
];

const set = (
  palette: SpritePalette,
  colourBlindPalette: SpritePalette,
  variants: readonly SpriteRows[],
): TerrainSpriteSet => ({ palette, colourBlindPalette, variants });

// Every motif was drawn for this project. The deliberately chunky shapes are
// judged at their native 16 px size, not as miniature illustrations.
export const TERRAIN_SPRITES: Readonly<Partial<Record<TerrainPattern, TerrainSpriteSet>>> = {
  [TerrainPattern.DeepOcean]: set(
    ['#071b45', '#03102e', '#0d3473', '#2d72b8', '#78c6df'],
    ['#132b4f', '#09172d', '#294f78', '#5d86a5', '#b1d2dc'],
    animated(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd..lll.........d',
        'd.ll.ll....m...d',
        'd.....mmmm.....d',
        'd............l.d',
        'd.mmmm.....lll.d',
        'd....mmmm......d',
        'd..............d',
        'd..lll.....mm..d',
        'd.ll.ll..mm....d',
        'd..............d',
        'd.....mmmm.....d',
        'd........llll..d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.ShallowOcean]: set(
    ['#1760a8', '#0a326d', '#237fbe', '#6bc3dd', '#c0edf0'],
    ['#466f92', '#203c59', '#6794ac', '#a5c6ca', '#e2eeee'],
    animated(
      rows(
        'dddddddddddddddd',
        'd..llll........d',
        'd.ll..ll...mm..d',
        'd........mmmm..d',
        'd..............d',
        'd.mmmm.....lll.d',
        'd....mmm.ll.ll.d',
        'd..............d',
        'd..lll.........d',
        'd.ll.ll...mmmm.d',
        'd......mmmm....d',
        'd..............d',
        'd....llll......d',
        'd...ll..ll.....d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Abyss]: set(
    ['#24213d', '#100d21', '#393550', '#67627d', '#a9a2b4'],
    ['#25334a', '#101927', '#465c6d', '#778d94', '#bdc7c4'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd..dd........l.d',
        'd..d.........l.d',
        'd..d....mmm..l.d',
        'd..ddd.mm.mm.l.d',
        'd....d.m...m...d',
        'd....d.mm.mm...d',
        'd....dd.mmm....d',
        'd.......d......d',
        'd......ddd.....d',
        'd.....dd.dd....d',
        'd..............d',
        'd...l..........d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Shelf]: set(
    ['#8e896c', '#454637', '#aaa37d', '#d1c69a', '#eee2b9'],
    ['#777e73', '#3a423f', '#929b8c', '#bcc3ad', '#e3e4cf'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd....llll......d',
        'd...l....l.....d',
        'd..........mm..d',
        'd.mmmmmmmmm....d',
        'd........mmmm..d',
        'd..............d',
        'd..ll......ll..d',
        'd.l..l....l..l.d',
        'd..............d',
        'd....mmmmmm....d',
        'd..mm......mm..d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.FreshLake]: set(
    ['#2b79b5', '#104577', '#3998c2', '#8dd7df', '#d2f1e9'],
    ['#537b94', '#2b4659', '#7399a4', '#b0ccca', '#e5eeea'],
    animated(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd..llll........d',
        'd.ll..ll...mm..d',
        'd.........mmmm.d',
        'd..............d',
        'd.mmmm...llll..d',
        'd....mmmll..ll.d',
        'd..............d',
        'd...llll.......d',
        'd..ll..ll......d',
        'd.........mmmm.d',
        'd......mmmm....d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.SaltLake]: set(
    ['#9fc7c7', '#476d73', '#bddbd4', '#edf5df', '#fff6c8'],
    ['#aab8ad', '#56625d', '#c7cdbd', '#eef0dc', '#fff4c3'],
    animated(
      rows(
        'dddddddddddddddd',
        'd..aaaa........d',
        'd.aa..aa.......d',
        'd........mmmm..d',
        'd......mmm.....d',
        'd..............d',
        'd.mmmm....aaaa.d',
        'd....mmm.aa..aad',
        'd..............d',
        'd...aaaa.......d',
        'd..aa..aa......d',
        'd.........mmmm.d',
        'd.......mmm....d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.SaltFlat]: set(
    ['#d3c99f', '#746d59', '#e7ddb8', '#fff3d2', '#ffffff'],
    ['#c5bd9f', '#696558', '#ddd5ba', '#f4ecd2', '#ffffff'],
    paired(
      rows(
        'dddddddddddddddd',
        'd....a.........d',
        'd...aaa....a...d',
        'd....a....aaa..d',
        'd.........a....d',
        'd..ddd.........d',
        'd.dd.dd...llll.d',
        'd.....dd.ll..lld',
        'd......dd......d',
        'd...a...dd.....d',
        'd..aaa...ddd...d',
        'd...a..........d',
        'd......llll....d',
        'd.....ll..ll...d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Ice]: set(
    ['#d7f0ef', '#6d9eaa', '#b7dcdf', '#f2ffff', '#ffffff'],
    ['#dae5de', '#718b86', '#b9cfca', '#f3f8ee', '#ffffff'],
    paired(
      rows(
        '................',
        '.llllll.........',
        '.l....llll......',
        '.l.......lll....',
        '.llll.......l...',
        '....d...........',
        '...ddd......aaa.',
        '.....dd....a...a',
        '......d...a...aa',
        '......ddd.a.aaa.',
        '........d.aa....',
        '..llll..dd......',
        '.ll..lllld......',
        '.l.......ddd....',
        '.lllllll........',
        '................',
      ),
    ),
  ),
  [TerrainPattern.Tundra]: set(
    ['#9b9f68', '#46513b', '#747c4f', '#c5c88b', '#77746b'],
    ['#a09b72', '#4e5041', '#7c7858', '#cbc398', '#797779'],
    paired(
      rows(
        '................',
        '................',
        '..l.l.......aa..',
        '.dldld.....aaaa.',
        '..ddd.......aa..',
        '.........m......',
        '........mmm.....',
        '..aa.....m......',
        '.aaaa...........',
        '..aa......l.l...',
        '.........dldld..',
        '...m......ddd...',
        '..mmm...........',
        '...m............',
        '................',
        '................',
      ),
    ),
  ),
  [TerrainPattern.BorealForest]: set(
    ['#1d4d3b', '#092820', '#2f6d49', '#65a261', '#9bc477'],
    ['#2b5362', '#132f39', '#437482', '#75a19c', '#b7c28a'],
    paired(
      rows(
        '................',
        '...d............',
        '..dld......d....',
        '.dlmld....dld...',
        '..dld....dlmld..',
        '.dlmld....dld...',
        'dmmmlmd..dlmld..',
        '...d....dmmmlmd.',
        '...d.......d....',
        '.........d.d....',
        '...d....dldld...',
        '..dld..dlmmld...',
        '.dlmld.dmmmmld..',
        'dmmmlmd...d.....',
        '...d......d.....',
        '................',
      ),
    ),
  ),
  [TerrainPattern.TemperateForest]: set(
    ['#397f3f', '#163d27', '#4e9c48', '#7fc65c', '#b8dc72'],
    ['#39727e', '#1c3d48', '#55929a', '#87b7aa', '#d1d086'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..dddd........d',
        'd.dmmmdd..dddd.d',
        'ddmmlmdddmmmmd.d',
        'dmmmmmddmmmlmddd',
        'ddmmmddmmmmmmmdd',
        'd.ddd...dmmmdd.d',
        'd..d....dddd...d',
        'd......dddd....d',
        'd.ddd.dmmmdd...d',
        'ddmmddmmlmmdd..d',
        'dmmlmddmmmmd...d',
        'ddmmmdd.ddd....d',
        'd.ddd...d......d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Grassland]: set(
    ['#8fbb4f', '#355f32', '#6f9c3e', '#b8d568', '#e1e67a'],
    ['#a8a84d', '#53552d', '#858444', '#caca72', '#ece39a'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd...d..........d',
        'd..d.d.....d...d',
        'd...d.....d.d..d',
        'd..lll.....d...d',
        'd..............d',
        'd.........d....d',
        'd..d.....d.d...d',
        'd.d.d.....d....d',
        'd..d.....lll...d',
        'd.lll..........d',
        'd..............d',
        'd.....d........d',
        'd....lll.......d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Desert]: set(
    ['#d5ad56', '#7b542c', '#ebc76c', '#ffe096', '#fff0b4'],
    ['#d29a50', '#74482f', '#e5b46a', '#f6d59b', '#ffe9c2'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd....llll......d',
        'd..lll..lll....d',
        'd.ll......llll.d',
        'd..........d...d',
        'd..........d.d.d',
        'd........ddd.d.d',
        'd..........ddd.d',
        'd..........d...d',
        'd...mmmm...d...d',
        'd.mmm..mmmm....d',
        'dmm........mmm.d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Savanna]: set(
    ['#b6a73f', '#5d5728', '#8d8a32', '#d8c95d', '#e8df86'],
    ['#ba984a', '#644a2d', '#997343', '#d8bc75', '#eddda0'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd......dddd....d',
        'd.....dmmmdd...d',
        'd....dmmmlmdd..d',
        'd...ddmmmmmmdd.d',
        'd.....dddddd...d',
        'd........d.....d',
        'd..d.....d.....d',
        'd.d.d....d.....d',
        'd..d.....d.....d',
        'd.lll...ddd....d',
        'd..............d',
        'd.....d........d',
        'd....lll.......d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Rainforest]: set(
    ['#156b35', '#07351f', '#248745', '#52b653', '#91da67'],
    ['#17677a', '#0a3542', '#2a8290', '#59a9a6', '#a5ce9b'],
    paired(
      rows(
        'dddddddddddddddd',
        'd.ddd...dddd...d',
        'ddmmdd.dmmmmdd.d',
        'dmmlmddmmlmmmddd',
        'dmmmmmmmmmmmmmdd',
        'ddmmmmddmmmmmddd',
        'd.dddd..ddddd..d',
        'd..d...d..d....d',
        'd.ddd.dddddddd.d',
        'ddmmmddmmmmmmddd',
        'dmmmlmmmmmlmmmdd',
        'ddmmmmmmmmmmmmdd',
        'd.dddd.dddddd..d',
        'd..d....d..d...d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Swamp]: set(
    ['#536f55', '#263b32', '#6d8962', '#9ead72', '#c9ce8a'],
    ['#576e72', '#2c3c42', '#738b88', '#a5af91', '#d3cf9b'],
    paired(
      rows(
        'dddddddddddddddd',
        'd....d.........d',
        'd.d..d..d......d',
        'd..d.d.d.......d',
        'd...ddd........d',
        'd....d.....d...d',
        'd....d...d.d...d',
        'd.mmmmm...d....d',
        'dmm...mmmmmmm..d',
        'd.......mm..mm.d',
        'd..d...........d',
        'd.d.d....llll..d',
        'd..d....ll..ll.d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Mountain]: set(
    ['#777776', '#34373d', '#62666b', '#a7a8a6', '#d6d4ca'],
    ['#737d80', '#353e43', '#5e6a6d', '#a2abad', '#d8d9ce'],
    paired(
      rows(
        '................',
        '.........d......',
        '........dld.....',
        '.......dllmd....',
        '......dllmmd....',
        '.....dllmmmmd...',
        '....dldmmmmmd...',
        '...dlldmmmmmmmd.',
        '..dlllmmmmmmmmd.',
        '.dldlllmmmmmmmmd',
        'dllldllmmmmmmmmd',
        'dlllmddmmmmmmmmd',
        'dllmmmdmmmmmmmmd',
        'dmmmmmmmmmmmmmm.',
        'ddddddddddddddd.',
        '................',
      ),
    ),
  ),
  [TerrainPattern.SnowMountain]: set(
    ['#7b8589', '#333b43', '#676f75', '#c4d5d7', '#f5ffff'],
    ['#737f82', '#343e42', '#626e70', '#c4cfca', '#f7f9ec'],
    paired(
      rows(
        '................',
        '.........d......',
        '........dad.....',
        '.......daaad....',
        '......daaamd....',
        '.....daalmmmd...',
        '....daddmmmmd...',
        '...daadmmmmmmmd.',
        '..dalldmmmmmmmmd',
        '.daddllmmmmmmmmd',
        'daaaddlmmmmmmmmd',
        'dlllmddmmmmmmmmd',
        'dllmmmdmmmmmmmmd',
        'dmmmmmmmmmmmmmm.',
        'ddddddddddddddd.',
        '................',
      ),
    ),
  ),
  [TerrainPattern.Rock]: set(
    ['#746b64', '#37343a', '#5b5553', '#9b8f83', '#c2b49e'],
    ['#6f7072', '#383b41', '#595e63', '#93999a', '#c4c2b5'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..............d',
        'd...dddd.......d',
        'd..dlllmd......d',
        'd.dllmmmdd.....d',
        'd.dmmmmmd......d',
        'd..dddddd......d',
        'd..............d',
        'd.......dddd...d',
        'd......dllmmd..d',
        'd.....dllmmmmd.d',
        'd.....dmmmmmd..d',
        'd......ddddd...d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
  [TerrainPattern.Lava]: set(
    ['#362b2b', '#17171b', '#59403a', '#d24b25', '#ffb326'],
    ['#3c333c', '#1b1922', '#5e4858', '#b95d4f', '#ffc24e'],
    paired(
      rows(
        'dddddddddddddddd',
        'd..ddd.........d',
        'd.ddmdd........d',
        'd.dmaaadd......d',
        'd.ddaadd.......d',
        'd..daad...ddd..d',
        'd...da...ddadd.d',
        'd...daa.ddaadd.d',
        'd....daadaadd..d',
        'd....daaddd....d',
        'd...ddaaad.....d',
        'd.dddaadd......d',
        'd.ddddd........d',
        'd..............d',
        'd..............d',
        'dddddddddddddddd',
      ),
    ),
  ),
};

export function terrainSpriteVariantCount(pattern: TerrainPattern): number {
  return TERRAIN_SPRITES[pattern]!.variants.length;
}

export function terrainSpriteRows(pattern: TerrainPattern, variant: number): SpriteRows {
  const variants = TERRAIN_SPRITES[pattern]!.variants;
  return variants[((variant % variants.length) + variants.length) % variants.length]!;
}

export function terrainSpritePalette(
  pattern: TerrainPattern,
  paletteMode: PaletteMode,
): SpritePalette {
  const sprite = TERRAIN_SPRITES[pattern]!;
  return paletteMode === 'colourBlind' ? sprite.colourBlindPalette : sprite.palette;
}

const SYMBOL_INDEX: Readonly<Record<string, number>> = { '.': 0, d: 1, m: 2, l: 3, a: 4 };

/** Paints one sprite with integer-aligned rectangles; used only on cache misses and by the preview. */
export function paintTerrainSprite(
  ctx: CanvasRenderingContext2D,
  pattern: TerrainPattern,
  variant: number,
  size: number,
  paletteMode: PaletteMode,
  tinted = false,
): void {
  const spriteRows = terrainSpriteRows(pattern, variant);
  const palette = terrainSpritePalette(pattern, paletteMode);
  const tintedPalette = [
    'rgba(0,0,0,0)',
    'rgba(0,0,0,.48)',
    'rgba(0,0,0,.2)',
    'rgba(255,255,255,.32)',
    'rgba(255,255,255,.62)',
  ];
  let previous = '';
  for (let y = 0; y < TILE_LOGICAL_SIZE; y++) {
    const top = Math.round((y * size) / TILE_LOGICAL_SIZE);
    const bottom = Math.round(((y + 1) * size) / TILE_LOGICAL_SIZE);
    const row = spriteRows[y]!;
    for (let x = 0; x < TILE_LOGICAL_SIZE; x++) {
      const symbol = row[x]!;
      if (tinted && symbol === '.') continue;
      const color = tinted
        ? tintedPalette[SYMBOL_INDEX[symbol]!]!
        : palette[SYMBOL_INDEX[symbol]!]!;
      if (color !== previous) {
        ctx.fillStyle = color;
        previous = color;
      }
      const left = Math.round((x * size) / TILE_LOGICAL_SIZE);
      const right = Math.round(((x + 1) * size) / TILE_LOGICAL_SIZE);
      ctx.fillRect(left, top, right - left, bottom - top);
    }
  }
}
