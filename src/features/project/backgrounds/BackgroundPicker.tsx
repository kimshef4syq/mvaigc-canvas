import { Pause, Play, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useHomeAppearanceStore } from '@/stores/homeAppearanceStore';
import { homeBackgrounds } from './catalog';

export function BackgroundPicker() {
  const { t } = useTranslation();
  const { background, paused, setBackground, togglePaused } = useHomeAppearanceStore();
  return (
    <div className="home-background-controls">
      <label className="home-background-select">
        <SlidersHorizontal size={14} aria-hidden="true" />
        <span className="sr-only">{t('mainHome.background')}</span>
        <select value={background} onChange={(event) => {
          const preset = homeBackgrounds.find((item) => item.id === event.target.value);
          if (preset) setBackground(preset.id);
        }}>
          {homeBackgrounds.map((preset) => (
            <option key={preset.id} value={preset.id}>{t(preset.labelKey)}</option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className="home-background-pause"
        disabled={background === 'none'}
        onClick={togglePaused}
        aria-label={t(paused ? 'mainHome.resumeBackground' : 'mainHome.pauseBackground')}
        title={t(paused ? 'mainHome.resumeBackground' : 'mainHome.pauseBackground')}
        aria-pressed={paused}
      >
        {paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
    </div>
  );
}
