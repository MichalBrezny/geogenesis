import { formatFixed, formatNumber, t } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';

/** Compact read-only summary of the physical planet and star parameters. */
export function PlanetPanel({
  frame,
  onCopyShareLink,
}: {
  frame: Frame;
  onCopyShareLink: () => void;
}) {
  const p = frame.planetParams;
  const rows = [
    [t('share.seed'), formatNumber(frame.creation.seed)],
    [t('planet.radius'), `${formatNumber(p.radius / 1000)} km`],
    [t('planet.gravity'), `${formatFixed(p.surfaceGravity, 2)} m/s²`],
    [t('planet.orbit'), `${formatFixed(p.orbitalDistanceAu, 3)} AU`],
    [t('planet.star'), p.starType],
    [t('planet.day'), `${formatNumber(p.rotationPeriodHours)} h`],
    [t('planet.tidalLock'), t(p.tidallyLocked ? 'planet.yes' : 'planet.no')],
    [t('planet.magneticField'), `${Math.round(frame.magneticField * 100)}%`],
    [t('planet.tectonics'), t(`planet.${frame.tectonicRegime}`)],
  ];
  return (
    <>
      <dl className="planet-parameters">
        {rows.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="planet-share">
        <button type="button" onClick={onCopyShareLink} title={t('share.copyHint')}>
          {t('share.copy')}
        </button>
        <small>{t('share.startingPlanetOnly')}</small>
      </div>
    </>
  );
}
