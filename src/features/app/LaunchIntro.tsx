import { useEffect, useRef } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { useTranslation } from 'react-i18next';
import './launchIntro.css';

const INTRO_DURATION_MS = 3000;

export function LaunchIntro({ onComplete }: { onComplete: () => void }) {
  const { t } = useTranslation();
  const completeRef = useRef(onComplete);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const finishedRef = useRef(false);
  completeRef.current = onComplete;

  useEffect(() => {
    const surface = surfaceRef.current;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let fallbackTimer = 0;
    let audio: HTMLAudioElement | null = null;
    let cancelled = false;
    const startedAt = performance.now();

    const finish = () => {
      if (!finishedRef.current) {
        finishedRef.current = true;
        completeRef.current();
      }
    };
    const playBrowserSound = () => {
      if (cancelled) return;
      audio = new Audio(`${import.meta.env.BASE_URL}startup/intro.wav`);
      audio.currentTime = Math.min((performance.now() - startedAt) / 1000, 2.9);
      void audio.play().catch(() => {
        // Autoplay can be blocked in browser previews; desktop uses native playback.
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') finish();
    };
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target === surface && event.animationName === 'launch-dismiss') finish();
    };
    const onMotionChange = () => {
      if (reducedMotion.matches) finish();
    };

    window.addEventListener('keydown', onKeyDown);
    surface?.addEventListener('animationend', onAnimationEnd);
    reducedMotion.addEventListener('change', onMotionChange);
    if (reducedMotion.matches) {
      finish();
    } else {
      // Start without waiting for a repaint: background-launched WKWebViews may
      // defer requestAnimationFrame until the first pointer interaction.
      surface?.classList.add('launch-intro-playing');
      if (isTauri()) {
        // Native playback avoids WKWebView's audible-autoplay gesture restriction.
        void invoke('play_startup_sound').catch((error) => {
          console.warn('Native startup sound unavailable', error);
          playBrowserSound();
        });
      } else {
        playBrowserSound();
      }
      fallbackTimer = window.setTimeout(finish, INTRO_DURATION_MS + 150);
    }
    return () => {
      cancelled = true;
      window.clearTimeout(fallbackTimer);
      window.removeEventListener('keydown', onKeyDown);
      surface?.removeEventListener('animationend', onAnimationEnd);
      reducedMotion.removeEventListener('change', onMotionChange);
      audio?.pause();
      if (isTauri()) void invoke('stop_startup_sound').catch(() => {});
    };
  }, []);

  return (
    <div ref={surfaceRef} className="launch-intro" role="dialog" aria-modal="true" aria-label={t('mainHome.startupAnimation')}>
      <div className="launch-orbit-stage" aria-hidden="true">
        <div className="launch-orbit"><i /><i /><i /><b /></div>
        <div className="launch-line" />
      </div>
      <div className="launch-paper-stage" aria-hidden="true">
        <div className="launch-title launch-chinese-title">
          {[...'融媒视界'].map((letter, index) => <span key={letter} style={{ '--letter': index } as React.CSSProperties}>{letter}</span>)}
        </div>
        <p className="launch-tagline">把灵感连接成作品</p>
      </div>
      <div className="launch-orange-wipe" aria-hidden="true" />
      <div className="launch-orange-stage" aria-hidden="true">
        <div className="launch-title launch-latin-title">
          {[...'MVAIGC'].map((letter, index) => <span key={letter} style={{ '--letter': index } as React.CSSProperties}>{letter}</span>)}
        </div>
      </div>
      <div className="launch-grain" aria-hidden="true" />
      <div className="launch-frame" aria-hidden="true">
        <span>MVAIGC — 融媒视界</span><span>CREATE / CONNECT</span>
        <i /><i /><i /><i />
      </div>
      <button type="button" className="launch-skip" onClick={onComplete}>{t('mainHome.skipIntro')}</button>
    </div>
  );
}
