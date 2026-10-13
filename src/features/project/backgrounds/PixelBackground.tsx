import { useEffect, useRef } from 'react';
import { useHomeAppearanceStore } from '@/stores/homeAppearanceStore';
import { useThemeStore } from '@/stores/themeStore';
import { homeBackgrounds } from './catalog';

const glyphs: Record<string, string[]> = {
  M: ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  G: ['01110', '10001', '10000', '10111', '10001', '10001', '01110'],
  C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
};
const pixels = [...'MVAIGC'].flatMap((letter, index) =>
  glyphs[letter].flatMap((row, y) => [...row].flatMap((value, x) =>
    value === '1' ? [{ x: index * 6 + x, y }] : [],
  )),
);

export function PixelBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const elapsedRef = useRef(0);
  const background = useHomeAppearanceStore((state) => state.background);
  const paused = useHomeAppearanceStore((state) => state.paused);
  const theme = useThemeStore((state) => state.theme);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || background === 'none') return;
    const context = canvas.getContext('2d');
    if (!context) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const preset = homeBackgrounds.find((item) => item.id === background)!;
    let width = 0;
    let height = 0;
    let frame = 0;
    let elapsed = elapsedRef.current;
    let heroTop = 70;
    let last = 0;
    let lastDraw = 0;

    const draw = () => {
      context.clearRect(0, 0, width, height);
      const step = Math.min(13, Math.max(6, width * (width < 768 ? 0.024 : 0.013)));
      const originX = width < 768 ? (width - 35 * step) / 2 : width * 0.71 - 17.5 * step;
      const originY = heroTop + (width < 768 ? 160 : 55);
      const time = elapsed / 1000;
      context.fillStyle = preset.color;
      // Sparse ambient pixels; the center stays quiet so project labels remain readable.
      for (let i = 0; i < 65; i++) {
        const x = ((i * 137.37 + Math.sin(time * 0.15 + i) * 16) % (width + 40)) - 20;
        const y = ((i * 83.71 - time * (2 + i % 3)) % (height + 40) + height + 40) % (height + 40) - 20;
        context.globalAlpha = (theme === 'dark' ? 0.13 : 0.18) * (0.6 + Math.sin(i + time * 0.6) * 0.4);
        context.fillRect(Math.round(x), Math.round(y), i % 4 === 0 ? 4 : 2, i % 4 === 0 ? 4 : 2);
      }
      pixels.forEach((pixel, index) => {
        let x = originX + pixel.x * step;
        let y = originY + pixel.y * step;
        let light = 0.7;
        if (background === 'assemble') {
          const scatter = Math.pow(Math.max(0, Math.sin(time * Math.PI / 8 - Math.PI / 2)), 8);
          x += Math.sin(index * 17.3) * scatter * step * 5;
          y += Math.cos(index * 7.9) * scatter * step * 4;
          light += Math.sin(pixel.x * 0.32 - time * 1.5) * 0.25;
        } else if (background === 'wave') {
          y += Math.sin(pixel.x * 0.22 - time * 0.85) * step * 0.7;
          light += Math.sin(pixel.x * 0.25 - time) * 0.25;
        } else {
          x += Math.cos(time * 0.55 + pixel.y * 0.22) * step * 0.35;
          y += Math.sin(time * 0.55 + pixel.x * 0.13) * step * 0.5;
          light += Math.cos(index * 0.2 - time) * 0.25;
        }
        context.globalAlpha = light * (theme === 'dark' ? 0.7 : 0.8);
        context.fillRect(Math.round(x), Math.round(y), Math.max(3, step - 3), Math.max(3, step - 3));
      });
      // Orbiting satellites frame the pixel word without obscuring it.
      if (background === 'orbit') {
        for (let i = 0; i < 22; i++) {
          const angle = i * Math.PI * 2 / 22 + time * 0.18;
          context.globalAlpha = 0.12 + (i % 4) * 0.05;
          context.fillRect(
            Math.round(originX + 17.5 * step + Math.cos(angle) * step * 21),
            Math.round(originY + 3 * step + Math.sin(angle) * step * 6), 3, 3,
          );
        }
      }
      context.globalAlpha = 1;
    };

    const tick = (timestamp: number) => {
      if (last) elapsed += Math.min(timestamp - last, 100);
      last = timestamp;
      if (timestamp - lastDraw >= 1000 / 30) {
        draw();
        lastDraw = timestamp;
      }
      frame = requestAnimationFrame(tick);
    };
    const syncPlayback = () => {
      cancelAnimationFrame(frame);
      last = 0;
      draw();
      if (!paused && !media.matches && !document.hidden) frame = requestAnimationFrame(tick);
    };
    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const hero = canvas.parentElement?.querySelector('.home-hero');
      heroTop = hero ? hero.getBoundingClientRect().top - bounds.top : 70;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      draw();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    media.addEventListener('change', syncPlayback);
    document.addEventListener('visibilitychange', syncPlayback);
    resize();
    syncPlayback();
    return () => {
      elapsedRef.current = elapsed;
      cancelAnimationFrame(frame);
      observer.disconnect();
      media.removeEventListener('change', syncPlayback);
      document.removeEventListener('visibilitychange', syncPlayback);
    };
  }, [background, paused, theme]);

  return background === 'none' ? null : (
    <canvas ref={canvasRef} className="home-pixel-background" aria-hidden="true" />
  );
}
