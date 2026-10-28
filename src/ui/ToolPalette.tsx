import { t, type MessageKey } from '../i18n/i18n';
import { LIFE_CLASSES, type LifeClassKey } from '../sim/data/lifeClasses';
import { TOOL_IDS, TOOLS, type ToolId } from '../sim/tools/tools';
import type { Frame } from '../worker/protocol';
import { TOOL_ICONS } from './icons';

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
    <div className="tools">
      <div
        className="tool-buttons"
        role="group"
        aria-label={t('tools.title')}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
          const buttons = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
          ];
          const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
          if (current < 0 || buttons.length === 0) return;
          event.preventDefault();
          const columns = 2;
          const delta =
            event.key === 'ArrowLeft'
              ? -1
              : event.key === 'ArrowRight'
                ? 1
                : event.key === 'ArrowUp'
                  ? -columns
                  : columns;
          buttons[(current + delta + buttons.length) % buttons.length]?.focus();
        }}
      >
        {TOOL_IDS.map((id) => (
          <button
            key={id}
            aria-pressed={tool === id}
            className={tool === id ? 'selected' : undefined}
            disabled={!affordable(id)}
            onClick={() => props.onToolChange(tool === id ? null : id)}
            title={t(`toolHelp.${id}` as MessageKey)}
          >
            {TOOL_ICONS[id]}
            <span className="label">{t(`tool.${id}` as MessageKey)}</span>
            <span className="cost">Ω{TOOLS[id].cost}</span>
          </button>
        ))}
      </div>
      {tool === 'seedLife' && (
        <label>
          {t('tools.lifeClass')}{' '}
          <select
            title={t('tools.lifeClass')}
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
          title={t('tools.experimental')}
          type="checkbox"
          checked={frame.unlimitedEnergy}
          onChange={(e) => props.onUnlimitedEnergyChange(e.target.checked)}
        />{' '}
        {t('tools.experimental')}
      </label>
    </div>
  );
}
