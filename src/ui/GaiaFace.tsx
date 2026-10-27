import { t, type MessageKey } from '../i18n/i18n';
import type { GaiaDiagnostic, GaiaMood } from '../sim/diagnostics';

const MOUTHS: Record<Exclude<GaiaMood, 'asleep'>, string> = {
  happy: 'M 7 14 Q 12 19 17 14',
  neutral: 'M 8 16 L 16 16',
  sad: 'M 7 18 Q 12 13 17 18',
  sick: 'M 7 18 Q 9 14 12 18 T 17 18',
};

/** Small inline-SVG Gaia expression; size is controlled by the surrounding CSS. */
export function GaiaFace({ gaia, large = false }: { gaia: GaiaDiagnostic; large?: boolean }) {
  const title = t('gaia.hint', {
    score: Math.round(gaia.score),
    mood: t(`gaia.mood.${gaia.mood}` as MessageKey),
    drag: t(`gaia.drag.${gaia.biggestDrag}` as MessageKey),
  });
  const asleep = gaia.mood === 'asleep';
  return (
    <span className={`gaia-face ${large ? 'large' : ''} ${gaia.mood}`} title={title}>
      <svg viewBox="0 0 24 24" role="img" aria-label={title}>
        <circle cx="12" cy="12" r="10" />
        {asleep ? (
          <>
            <path d="M 6 10 Q 8 12 10 10 M 14 10 Q 16 12 18 10" />
            <path d="M 9 17 Q 12 18 15 17" />
          </>
        ) : (
          <>
            <circle className="eye" cx="8.5" cy="10" r="1" />
            <circle className="eye" cx="15.5" cy="10" r="1" />
            <path d={MOUTHS[gaia.mood as Exclude<GaiaMood, 'asleep'>]} />
            {gaia.mood === 'sick' && <path d="M 18 5 Q 21 8 18 11 Q 15 8 18 5" />}
          </>
        )}
      </svg>
      {large && (
        <span>
          <strong>{t('gaia.score', { score: Math.round(gaia.score) })}</strong>
          <small>
            {t('gaia.biggestDrag', { drag: t(`gaia.drag.${gaia.biggestDrag}` as MessageKey) })}
          </small>
        </span>
      )}
    </span>
  );
}
