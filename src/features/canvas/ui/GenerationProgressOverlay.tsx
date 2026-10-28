import { useEffect, useState } from 'react';

/** Estimated progress; reserve the final portion until the provider completes. */
export function GenerationProgressOverlay({ startedAt, durationMs = 60000 }: {
  startedAt?: number | null;
  durationMs?: number | null;
}) {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);
  const start = typeof startedAt === 'number' && Number.isFinite(startedAt) ? startedAt : mountedAt;
  const duration = typeof durationMs === 'number' && Number.isFinite(durationMs)
    ? Math.max(1000, durationMs) : 60000;
  const progress = Math.min(Math.max(0, now - start) / duration, 0.96);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-bg-dark/55" />
      <div
        className="absolute left-0 top-0 h-full w-full origin-left bg-gradient-to-r from-[rgba(255,255,255,0.4)] to-[rgba(255,255,255,0.06)] transition-transform duration-100 ease-linear"
        style={{ transform: `scaleX(${progress})` }}
      />
    </div>
  );
}
