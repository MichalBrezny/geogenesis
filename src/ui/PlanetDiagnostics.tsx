import { formatFixed, t, type MessageKey } from '../i18n/i18n';
import type { Frame } from '../worker/protocol';
import { selectCarbonSentence, selectEnergySentence } from './diagnosticReadouts';
import { GaiaFace } from './GaiaFace';

interface BarDatum {
  key: MessageKey;
  value: number;
  kind: 'source' | 'sink' | 'warming' | 'cooling';
}

function DiagnosticBars({ data }: { data: readonly BarDatum[] }) {
  const maximum = Math.max(1e-12, ...data.map((item) => Math.abs(item.value)));
  return (
    <div className="diagnostic-bars">
      {data.map((item) => (
        <div
          key={item.key}
          title={t('diagnostic.barHint', {
            name: t(item.key),
            value: formatFixed(item.value, 3),
          })}
        >
          <span>{t(item.key)}</span>
          <i>
            <b
              className={item.kind}
              style={{ width: `${(100 * Math.abs(item.value)) / maximum}%` }}
            />
          </i>
          <output>{formatFixed(item.value, Math.abs(item.value) < 0.1 ? 3 : 1)}</output>
        </div>
      ))}
    </div>
  );
}

/** Carbon and energy explanations shown below the Atmosphere controls. */
export function AtmosphereDiagnostics({ frame }: { frame: Frame }) {
  const carbon = frame.carbonBudget;
  const sources = (
    [
      {
        key: 'diagnostic.term.volcanoes',
        value: carbon.volcanicOutgassing.microbarPerYear + carbon.lipOutgassing.microbarPerYear,
        kind: 'source',
      },
      {
        key: 'diagnostic.term.civilization',
        value: carbon.civilizationEmissions.microbarPerYear,
        kind: 'source',
      },
      {
        key: 'diagnostic.term.clathrates',
        value: carbon.clathrateRelease.microbarPerYear,
        kind: 'source',
      },
      {
        key: 'diagnostic.term.deviceSources',
        value: carbon.deviceSources.microbarPerYear,
        kind: 'source',
      },
    ] satisfies BarDatum[]
  ).filter((item) => item.value > 0);
  const sinks = (
    [
      {
        key: 'diagnostic.term.weathering',
        value: -(carbon.landWeathering.microbarPerYear + carbon.seafloorWeathering.microbarPerYear),
        kind: 'sink',
      },
      {
        key: 'diagnostic.term.burial',
        value: -carbon.organicBurial.microbarPerYear,
        kind: 'sink',
      },
      {
        key: 'diagnostic.term.deviceSinks',
        value: -carbon.deviceSinks.microbarPerYear,
        kind: 'sink',
      },
    ] satisfies BarDatum[]
  ).filter((item) => item.value > 0);
  const energy = frame.energyBalance;
  const energySentence = selectEnergySentence(energy);
  return (
    <div className="planet-diagnostics">
      <section aria-labelledby="carbon-balance-heading">
        <h3 id="carbon-balance-heading">{t('diagnostic.carbonTitle')}</h3>
        <p className="diagnostic-net" title={t('diagnostic.carbonNetHint')}>
          <span aria-hidden="true">
            {carbon.net.microbarPerYear > 0 ? '↑' : carbon.net.microbarPerYear < 0 ? '↓' : '→'}
          </span>{' '}
          {t('diagnostic.carbonNet', {
            value: formatFixed(carbon.net.microbarPerYear, 3),
            gt: formatFixed(carbon.net.gtCarbonPerYear, 3),
          })}
        </p>
        <DiagnosticBars data={[...sources, ...sinks]} />
        <p>{t(selectCarbonSentence(carbon))}</p>
      </section>
      <section aria-labelledby="energy-balance-heading">
        <h3 id="energy-balance-heading">{t('diagnostic.energyTitle')}</h3>
        <p className="muted" title={t('diagnostic.energyFluxHint')}>
          {t('diagnostic.energyFlux', {
            absorbed: formatFixed(energy.absorbedSunlight, 1),
            outgoing: formatFixed(energy.outgoingLongwave, 1),
            margin: formatFixed(energy.runawayMargin, 1),
          })}
        </p>
        <DiagnosticBars
          data={[
            {
              key: 'diagnostic.term.co2',
              value: Math.max(0, energy.greenhouse.co2),
              kind: 'warming',
            },
            {
              key: 'diagnostic.term.waterVapor',
              value: Math.max(0, energy.greenhouse.waterVapor),
              kind: 'warming',
            },
            {
              key: 'diagnostic.term.methane',
              value: Math.max(0, energy.greenhouse.methane),
              kind: 'warming',
            },
            { key: 'diagnostic.term.ice', value: energy.cooling.iceAlbedo, kind: 'cooling' },
            { key: 'diagnostic.term.clouds', value: energy.cooling.cloudAlbedo, kind: 'cooling' },
            { key: 'diagnostic.term.haze', value: energy.cooling.haze, kind: 'cooling' },
            {
              key: 'diagnostic.term.aerosols',
              value: energy.cooling.dustAerosol,
              kind: 'cooling',
            },
          ]}
        />
        <p>{t(energySentence.key, { value: formatFixed(energySentence.value, 1) })}</p>
      </section>
    </div>
  );
}

export function BiosphereDiagnostics({ frame }: { frame: Frame }) {
  return (
    <section className="gaia-panel" aria-label={t('gaia.title')}>
      <h3>{t('gaia.title')}</h3>
      <GaiaFace gaia={frame.gaia} large />
    </section>
  );
}
