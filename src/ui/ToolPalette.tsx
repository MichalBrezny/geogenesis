import { t, type MessageKey } from '../i18n/i18n';
import { LIFE_CLASSES, type LifeClassKey } from '../sim/data/lifeClasses';
import { TOOL_IDS, TOOLS, type ToolId } from '../sim/tools/tools';
import type { Frame } from '../worker/protocol';

interface Props {
  frame: Frame;
  tool: ToolId | null;
  onToolChange: (tool: ToolId | null) => void;
  lifeClass: LifeClassKey;
  onLifeClassChange: (lifeClass: LifeClassKey) => void;
  onUnlimitedEnergyChange: (enabled: boolean) => void;
}

/**
 * SimEarth-style tool palette: pick a tool, then click the map. Each tool shows
 * its Ω cost; tools the budget cannot pay for are disabled.
 */
export function ToolPalette(props: Props) {
  const { frame, tool, lifeClass } = props;
  const affordable = (id: ToolId) => frame.unlimitedEnergy || frame.energy >= TOOLS[id].cost;
  const evolved = LIFE_CLASSES.filter((_, c) => frame.life.appeared[c] != null);
  return (
    <section className="panel tools" aria-label={t('tools.title')}>
      <h2>
        {t('tools.title')}{' '}
        <span className="energy">
          {frame.unlimitedEnergy
            ? t('tools.unlimited')
            : t('tools.energy', { value: Math.floor(frame.energy) })}
        </span>
      </h2>
      <div className="tool-buttons" role="group" aria-label={t('tools.title')}>
        {TOOL_IDS.map((id) => (
          <button
            key={id}
            aria-pressed={tool === id}
            className={tool === id ? 'selected' : undefined}
            disabled={!affordable(id)}
            onClick={() => props.onToolChange(tool === id ? null : id)}
            title={t(`toolHelp.${id}` as MessageKey)}
          >
            {t(`tool.${id}` as MessageKey)} <span className="cost">Ω{TOOLS[id].cost}</span>
          </button>
        ))}
      </div>
      {tool === 'seedLife' && (
        <label>
          {t('tools.lifeClass')}{' '}
          <select
            value={lifeClass}
            onChange={(e) => props.onLifeClassChange(e.target.value as LifeClassKey)}
          >
            {evolved.map(({ key }) => (
              <option key={key} value={key}>
                {t(`lifeClass.${key}`)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="muted">{tool ? t(`toolHelp.${tool}` as MessageKey) : t('tools.hint')}</p>
      <label className="experimental">
        <input
          type="checkbox"
          checked={frame.unlimitedEnergy}
          onChange={(e) => props.onUnlimitedEnergyChange(e.target.checked)}
        />{' '}
        {t('tools.experimental')}
      </label>
    </section>
  );
}
