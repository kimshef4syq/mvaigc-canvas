import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Moon, Sun, Sparkles } from 'lucide-react';
import { useThemeStore } from '@/stores/themeStore';
import { SKIN_OPTIONS, type SkinPreset } from '@/features/theme/skinPresets';

// ============================================================================
// Custom Bespoke SVGs for Each Skin Preset
// ============================================================================

/** 1. 新皮肤：黑曜琥珀 (Obsidian Warm Amber with Cool Rim Contrast) */
export function WarmAmberSkinIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="wa-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#2c1a0e" />
          <stop offset="100%" stopColor="#0d0805" />
        </radialGradient>
        <linearGradient id="wa-sun" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fde68a" />
          <stop offset="50%" stopColor="#f59e0b" />
          <stop offset="100%" stopColor="#d97706" />
        </linearGradient>
        <radialGradient id="wa-cool" cx="15%" cy="15%" r="70%">
          <stop offset="0%" stopColor="#818cf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#4338ca" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Background squircle */}
      <rect width="32" height="32" rx="8" fill="url(#wa-bg)" stroke="#f59e0b" strokeOpacity="0.4" strokeWidth="1.2" />
      {/* Cool atmospheric rim aura */}
      <path d="M4 14C4 8.477 8.477 4 14 4" stroke="#6366f1" strokeWidth="2.4" strokeLinecap="round" opacity="0.85" />
      <circle cx="8" cy="8" r="4" fill="url(#wa-cool)" />
      {/* Warm radiating sunburst & central jewel */}
      <circle cx="18" cy="18" r="5.5" fill="url(#wa-sun)" />
      {/* Radiant golden rays */}
      <line x1="18" y1="9" x2="18" y2="10.5" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="18" y1="25.5" x2="18" y2="27" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="9" y1="18" x2="10.5" y2="18" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="25.5" y1="18" x2="27" y2="18" stroke="#fbbf24" strokeWidth="1.8" strokeLinecap="round" />
      <line x1="11.5" y1="11.5" x2="12.8" y2="12.8" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="23.2" y1="23.2" x2="24.5" y2="24.5" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="24.5" y1="11.5" x2="23.2" y2="12.8" stroke="#fbbf24" strokeWidth="1.6" strokeLinecap="round" />
      <line x1="12.8" y1="23.2" x2="11.5" y2="24.5" stroke="#f59e0b" strokeWidth="1.6" strokeLinecap="round" />
      {/* Center spark point */}
      <circle cx="18" cy="18" r="2.2" fill="#fffbeb" />
    </svg>
  );
}

/** 2. 原始皮肤：原版黑灰 (Classic Slate & Blue Minimalist) */
export function ClassicSlateSkinIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="cs-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#27272a" />
          <stop offset="100%" stopColor="#111113" />
        </radialGradient>
        <linearGradient id="cs-line" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#2563eb" />
        </linearGradient>
      </defs>
      {/* Background squircle */}
      <rect width="32" height="32" rx="8" fill="url(#cs-bg)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.2" />
      {/* Blueprint grid dots */}
      <circle cx="9" cy="9" r="1" fill="#71717a" opacity="0.6" />
      <circle cx="16" cy="9" r="1" fill="#71717a" opacity="0.6" />
      <circle cx="23" cy="9" r="1" fill="#71717a" opacity="0.6" />
      <circle cx="9" cy="23" r="1" fill="#71717a" opacity="0.6" />
      <circle cx="16" cy="23" r="1" fill="#71717a" opacity="0.6" />
      <circle cx="23" cy="23" r="1" fill="#71717a" opacity="0.6" />
      {/* Clean geometric connected nodes */}
      <rect x="8" y="13" width="7" height="6" rx="1.8" fill="#1e293b" stroke="#3b82f6" strokeWidth="1.2" />
      <rect x="18" y="11" width="7" height="6" rx="1.8" fill="#1e293b" stroke="#3b82f6" strokeWidth="1.2" />
      <path d="M15 16H18" stroke="url(#cs-line)" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="15" cy="16" r="1.5" fill="#60a5fa" />
      <circle cx="18" cy="14" r="1.5" fill="#60a5fa" />
    </svg>
  );
}

/** 3. 冷色风格：极光冷蓝 (Deep Glacial Cyan & Sapphire Aurora) */
export function CoolFrostSkinIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="cf-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0e2338" />
          <stop offset="100%" stopColor="#050a12" />
        </radialGradient>
        <linearGradient id="cf-cyan" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#a5f3fc" />
          <stop offset="50%" stopColor="#06b6d4" />
          <stop offset="100%" stopColor="#0284c7" />
        </linearGradient>
      </defs>
      {/* Background squircle */}
      <rect width="32" height="32" rx="8" fill="url(#cf-bg)" stroke="#06b6d4" strokeOpacity="0.45" strokeWidth="1.2" />
      {/* Glacial Aurora wave */}
      <path
        d="M5 23C10 17 18 25 27 15"
        stroke="#38bdf8"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.8"
      />
      <path
        d="M5 20C12 14 19 22 27 12"
        stroke="#818cf8"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.6"
      />
      {/* Central crystalline prism */}
      <path
        d="M16 6L21 11L16 16L11 11L16 6Z"
        fill="url(#cf-cyan)"
        stroke="#e0f2fe"
        strokeWidth="1"
      />
      <circle cx="16" cy="11" r="1.8" fill="#ffffff" />
      {/* Sparkling ice stars */}
      <path d="M23 7L24 9L26 10L24 11L23 13L22 11L20 10L22 9L23 7Z" fill="#38bdf8" opacity="0.9" />
      <circle cx="9" cy="20" r="1.4" fill="#a5f3fc" />
    </svg>
  );
}

/** 4. 暖色风格：落日熔金 (Sunset Flame & Molten Gold) */
export function SunsetGlowSkinIcon({ className = 'w-7 h-7' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
      <defs>
        <radialGradient id="sg-bg" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#301115" />
          <stop offset="100%" stopColor="#0f0506" />
        </radialGradient>
        <linearGradient id="sg-flame" x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#e11d48" />
          <stop offset="45%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#fde047" />
        </linearGradient>
      </defs>
      {/* Background squircle */}
      <rect width="32" height="32" rx="8" fill="url(#sg-bg)" stroke="#f97316" strokeOpacity="0.45" strokeWidth="1.2" />
      {/* Horizon caustics */}
      <ellipse cx="16" cy="23" rx="10" ry="2.5" fill="#f43f5e" opacity="0.35" />
      <ellipse cx="16" cy="24" rx="7" ry="1.5" fill="#fbbf24" opacity="0.4" />
      {/* Setting Sun Crest & Rising Flame */}
      <path
        d="M16 6C16 6 22 12 22 17C22 20.314 19.314 23 16 23C12.686 23 10 20.314 10 17C10 12 16 6 16 6Z"
        fill="url(#sg-flame)"
      />
      {/* Inner intense flame spark */}
      <path
        d="M16 11C16 11 19 15 19 18C19 19.657 17.657 21 16 21C14.343 21 13 19.657 13 18C13 15 16 11 16 11Z"
        fill="#fef08a"
      />
      <circle cx="16" cy="18" r="1.5" fill="#ffffff" />
    </svg>
  );
}

/** Mapping of preset to icon component */
export function getSkinIcon(preset: SkinPreset, className = 'w-7 h-7') {
  switch (preset) {
    case 'warm-amber':
      return <WarmAmberSkinIcon className={className} />;
    case 'classic':
      return <ClassicSlateSkinIcon className={className} />;
    case 'cool-frost':
      return <CoolFrostSkinIcon className={className} />;
    case 'sunset-glow':
      return <SunsetGlowSkinIcon className={className} />;
  }
}

// ============================================================================
// SkinSelector Main Component
// ============================================================================

export function SkinSelector() {
  const { i18n } = useTranslation();
  const { skin, setSkin, theme, toggleTheme } = useThemeStore();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  const isZh = i18n.language.startsWith('zh');
  const currentSkin = skin || 'warm-amber';

  const closeDropdown = useCallback(() => {
    setIsOpen(false);
  }, []);

  // Click outside to close
  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        closeDropdown();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeDropdown();
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeDropdown]);

  const handleSelectSkin = (nextSkin: SkinPreset) => {
    setSkin(nextSkin);
    closeDropdown();
  };

  // Determine current active skin color for indicator glow
  const activeOption = SKIN_OPTIONS.find((s) => s.id === currentSkin) || SKIN_OPTIONS[0];

  return (
    <div className="relative inline-flex items-center h-full" ref={dropdownRef}>
      {/* TitleBar Skin Trigger Button */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`group relative inline-flex h-full px-2.5 items-center gap-1.5 text-text-muted transition-all duration-150 hover:bg-bg-dark hover:text-text-dark ${
          isOpen ? 'bg-bg-dark text-text-dark' : ''
        }`}
        title={isZh ? '界面皮肤与风格选择' : 'Select Canvas Skin & Style'}
        aria-label={isZh ? '界面皮肤选择' : 'Skin selection'}
      >
        {/* Bespoke Mini Icon Badge for Current Skin */}
        <div className="relative flex items-center justify-center">
          {getSkinIcon(currentSkin, 'w-4 h-4 transition-transform group-hover:scale-110')}
          {/* Subtle color aura indicator */}
          <span
            className="absolute -bottom-0.5 -right-0.5 h-1.5 w-1.5 rounded-full ring-1 ring-surface-dark shadow-sm"
            style={{ backgroundColor: activeOption.accent }}
          />
        </div>
        <span className="hidden xl:inline text-xs font-medium tracking-tight">
          {isZh ? activeOption.name : activeOption.nameEn}
        </span>
      </button>

      {/* Floating Glassmorphic Skin Selection Dropdown */}
      {isOpen && (
        <div
          role="dialog"
          aria-label={isZh ? '皮肤风格设置' : 'Skin & Theme Settings'}
          className="absolute right-0 top-full mt-1.5 z-[1200] w-[310px] rounded-2xl border border-white/12 bg-[#120d09]/95 p-2.5 shadow-[0_24px_54px_rgba(0,0,0,0.75)] backdrop-blur-2xl animate-in fade-in zoom-in-95 duration-150 select-none text-text-dark"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-2 py-1.5 mb-1 border-b border-white/10">
            <div className="flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-accent" />
              <span className="text-xs font-semibold tracking-wide text-white">
                {isZh ? '画布视觉风格' : 'Canvas Style & Skin'}
              </span>
            </div>
            <span className="text-[10px] font-mono uppercase tracking-wider text-text-muted/75">
              {SKIN_OPTIONS.length} {isZh ? '款主题' : 'Themes'}
            </span>
          </div>

          {/* Skin Presets List */}
          <div className="space-y-1.5 py-1">
            {SKIN_OPTIONS.map((option) => {
              const isSelected = option.id === currentSkin;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => handleSelectSkin(option.id)}
                  className={`group/skin relative flex w-full items-center gap-3 rounded-xl p-2 text-left transition-all duration-150 ${
                    isSelected
                      ? 'bg-white/[0.09] ring-1 ring-white/20 shadow-sm'
                      : 'hover:bg-white/[0.05] hover:ring-1 hover:ring-white/10'
                  }`}
                >
                  {/* Skin Icon */}
                  <div className="shrink-0 transition-transform group-hover/skin:scale-105">
                    {getSkinIcon(option.id, 'w-8 h-8 drop-shadow-md')}
                  </div>

                  {/* Title & Description */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-1.5">
                      <span className={`text-[13px] font-semibold tracking-tight ${isSelected ? 'text-white' : 'text-white/85'}`}>
                        {isZh ? option.name : option.nameEn}
                      </span>
                      {/* Swatch dots */}
                      <div className="flex items-center gap-1 shrink-0">
                        {option.swatches.map((color, index) => (
                          <span
                            key={index}
                            className="inline-block h-2 w-2 rounded-full border border-black/30 shadow-xs"
                            style={{ backgroundColor: color }}
                          />
                        ))}
                      </div>
                    </div>
                    <p className="truncate text-[11px] leading-tight text-text-muted/80 mt-0.5">
                      {isZh ? option.desc : option.descEn}
                    </p>
                  </div>

                  {/* Active Checkmark Pill */}
                  {isSelected && (
                    <div
                      className="shrink-0 flex items-center justify-center h-5 w-5 rounded-full shadow-sm text-white"
                      style={{ backgroundColor: option.accent }}
                    >
                      <Check className="h-3 w-3 stroke-[2.5]" />
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          {/* Bottom Divider & Dark/Light Mode Quick Switch */}
          <div className="mt-1 pt-1.5 border-t border-white/10 flex items-center justify-between px-2">
            <span className="text-[11px] text-text-muted">
              {isZh ? '色彩模式' : 'Mode'}
            </span>
            <button
              type="button"
              onClick={toggleTheme}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.05] px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:bg-white/10 hover:text-white"
            >
              {theme === 'dark' ? (
                <>
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  <span>{isZh ? '浅色' : 'Light'}</span>
                </>
              ) : (
                <>
                  <Moon className="h-3.5 w-3.5 text-indigo-400" />
                  <span>{isZh ? '深色' : 'Dark'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
