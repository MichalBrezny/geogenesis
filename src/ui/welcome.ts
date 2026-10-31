import { shouldStartTour, type StorageLike } from './guide';

/** Set when the player turns the welcome off; it opens on every launch otherwise. */
export const WELCOME_STORAGE_KEY = 'geogenesis.welcome.hidden';

/** Accessing the localStorage property can itself throw in restricted browsing contexts. */
export function browserStorage(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function shouldShowWelcome(storage: StorageLike | undefined): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(WELCOME_STORAGE_KEY) !== 'true';
  } catch {
    return true;
  }
}

export function setWelcomeAtStartup(storage: StorageLike | undefined, show: boolean): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WELCOME_STORAGE_KEY, show ? 'false' : 'true');
    return true;
  } catch {
    return false;
  }
}

export type WelcomeExit = 'choose' | 'continue' | 'explore';
export type TourStart = 'after-world-change' | 'now' | 'none';

/** Keeps the guide behind onboarding and, where applicable, behind the requested world change. */
export function tourStartAfterWelcome(exit: WelcomeExit, tourIncomplete: boolean): TourStart {
  if (!tourIncomplete) return 'none';
  return exit === 'explore' ? 'now' : 'after-world-change';
}

export function initialOnboarding(storage: StorageLike | undefined): {
  welcome: boolean;
  tour: boolean;
} {
  const welcome = shouldShowWelcome(storage);
  return { welcome, tour: !welcome && shouldStartTour(storage) };
}
