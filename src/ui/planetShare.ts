import type { PlanetParameters } from '../sim/core/planet';
import { isScenarioId } from '../sim/scenarios';
import { PLANET_STARTS } from '../sim/world';
import type { PlanetCreation } from '../worker/protocol';
import { RESOLUTIONS } from './menuOptions';

const SHARE_VERSION = 'v1';
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const STAR_TYPES = ['F', 'G', 'K', 'M'] as const;
const TECTONIC_REGIMES = ['mobile', 'stagnant'] as const;

function encodeJson(value: object): string {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function decodeJson(value: string): unknown {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')));
}

function finiteNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isPlanetParameters(value: unknown): value is Partial<PlanetParameters> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const parameters = value as Record<string, unknown>;
  const numeric = [
    'radius',
    'surfaceGravity',
    'orbitalDistanceAu',
    'rotationPeriodHours',
    'initialWaterGel',
    'initialN2Bar',
    'initialCo2Microbar',
    'crustalCarbonBar',
    'dynamoStrength',
  ];
  if (numeric.some((key) => key in parameters && !Number.isFinite(parameters[key]))) return false;
  for (const key of [
    'radius',
    'surfaceGravity',
    'orbitalDistanceAu',
    'initialWaterGel',
    'initialN2Bar',
    'initialCo2Microbar',
    'crustalCarbonBar',
    'dynamoStrength',
  ]) {
    if (key in parameters && (parameters[key] as number) < 0) return false;
  }
  if ('hasMoon' in parameters && typeof parameters.hasMoon !== 'boolean') return false;
  if ('tidallyLocked' in parameters && typeof parameters.tidallyLocked !== 'boolean') return false;
  if ('starType' in parameters && !STAR_TYPES.includes(parameters.starType as never)) return false;
  if (
    'tectonicRegime' in parameters &&
    !TECTONIC_REGIMES.includes(parameters.tectonicRegime as never)
  )
    return false;
  return Object.keys(parameters).every((key) =>
    [...numeric, 'hasMoon', 'tidallyLocked', 'starType', 'tectonicRegime'].includes(key),
  );
}

/** Encodes the immutable recipe for a starting planet, never its evolved state. */
export function encodePlanetHash(creation: PlanetCreation): string {
  const params = new URLSearchParams();
  params.set('planet', SHARE_VERSION);
  params.set('scenario', creation.scenario);
  params.set('seed', String(creation.seed >>> 0));
  params.set('w', String(creation.width));
  params.set('h', String(creation.height));
  params.set('start', creation.start);
  params.set('difficulty', creation.difficulty ?? 'normal');
  params.set('pace', creation.adaptivePacing === false ? '0' : '1');
  if (creation.continentalFraction !== undefined)
    params.set('land', String(creation.continentalFraction));
  if (creation.planetParams && Object.keys(creation.planetParams).length > 0)
    params.set('params', encodeJson(creation.planetParams));
  return `#${params.toString().replaceAll('&', ';')}`;
}

/** Returns null for other hashes, unsupported versions and malformed recipes. */
export function decodePlanetHash(hash: string): PlanetCreation | null {
  try {
    const params = new URLSearchParams(hash.replace(/^#/, '').replaceAll(';', '&'));
    if (params.get('planet') !== SHARE_VERSION) return null;
    const scenario = params.get('scenario');
    const seed = finiteNumber(params.get('seed'));
    const width = finiteNumber(params.get('w'));
    const height = finiteNumber(params.get('h'));
    const start = params.get('start');
    const difficulty = params.get('difficulty');
    const pace = params.get('pace');
    const land = params.has('land') ? finiteNumber(params.get('land')) : undefined;
    if (
      !scenario ||
      !isScenarioId(scenario) ||
      seed === null ||
      !Number.isInteger(seed) ||
      seed < 0 ||
      seed > 0xffffffff ||
      width === null ||
      !Number.isInteger(width) ||
      height === null ||
      !Number.isInteger(height) ||
      !RESOLUTIONS.some(
        ([validWidth, validHeight]) => width === validWidth && height === validHeight,
      ) ||
      !start ||
      !PLANET_STARTS.includes(start as never) ||
      !difficulty ||
      !DIFFICULTIES.includes(difficulty as never) ||
      (pace !== '0' && pace !== '1') ||
      (land !== undefined && (land === null || land < 0 || land > 1))
    )
      return null;
    const encodedParameters = params.get('params');
    const planetParams = encodedParameters ? decodeJson(encodedParameters) : undefined;
    if (planetParams !== undefined && !isPlanetParameters(planetParams)) return null;
    return {
      scenario,
      seed,
      width,
      height,
      start: start as PlanetCreation['start'],
      difficulty: difficulty as PlanetCreation['difficulty'],
      adaptivePacing: pace === '1',
      ...(land === undefined ? {} : { continentalFraction: land }),
      ...(planetParams === undefined ? {} : { planetParams }),
    };
  } catch {
    return null;
  }
}

/** Uses the modern clipboard API, with a hidden textarea fallback for older browsers. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    let input: HTMLTextAreaElement | undefined;
    try {
      input = document.createElement('textarea');
      input.value = text;
      input.setAttribute('readonly', '');
      input.style.position = 'fixed';
      input.style.opacity = '0';
      document.body.append(input);
      input.select();
      const copied = document.execCommand('copy');
      return copied;
    } catch {
      return false;
    } finally {
      input?.remove();
    }
  }
}
