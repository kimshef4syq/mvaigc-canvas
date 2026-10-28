import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Maximize2, Pause, Play, Volume2, VolumeX } from 'lucide-react';
import { beginVideoSeekDrag } from './videoSeekDrag';

function timeLabel(seconds: number) {
  const value = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

/** Canvas-safe controls avoid WebView native scrubber mouse capture. */
export function CanvasVideoPlayer({ src, poster, autoPlay = false, className = '' }: {
  src: string;
  poster?: string;
  autoPlay?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const endSeekRef = useRef<(() => void) | null>(null);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
    setPlaying(false);
    return () => { endSeekRef.current?.(); endSeekRef.current = null; };
  }, [src]);
  const seekTo = (seconds: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return;
    video.currentTime = Math.max(0, Math.min(video.duration, seconds));
    setCurrentTime(video.currentTime);
  };
  const startSeek = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || duration <= 0) return;
    event.preventDefault();
    endSeekRef.current?.();
    const rect = event.currentTarget.getBoundingClientRect();
    const seek = (clientX: number) => {
      if (rect.width > 0) seekTo((clientX - rect.left) / rect.width * duration);
    };
    seek(event.clientX);
    endSeekRef.current = beginVideoSeekDrag(window, event.pointerId, seek, () => {
      endSeekRef.current = null;
    });
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => setPlaying(false));
    else video.pause();
  };
  return (
    <div
      ref={containerRef}
      className={`relative flex min-h-0 flex-col overflow-hidden bg-black ${className}`}
    >
      <video
        key={src}
        ref={videoRef}
        src={src}
        poster={poster}
        autoPlay={autoPlay}
        playsInline
        preload="metadata"
        draggable={false}
        className="min-h-0 w-full flex-1 cursor-grab object-contain active:cursor-grabbing"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onVolumeChange={() => setMuted(videoRef.current?.muted ?? false)}
        onLoadedMetadata={() => {
          const value = videoRef.current?.duration ?? 0;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onDurationChange={() => {
          const value = videoRef.current?.duration ?? 0;
          setDuration(Number.isFinite(value) ? value : 0);
        }}
        onTimeUpdate={() => setCurrentTime(videoRef.current?.currentTime ?? 0)}
      />
      <div
        className="nodrag nopan nowheel flex shrink-0 items-center gap-2 bg-black/85 px-2 py-1.5 text-white"
        data-canvas-no-marquee="true"
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" aria-label={t(playing ? 'node.videoNode.pause' : 'node.videoNode.play')} onClick={togglePlayback}>
          {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
        <div
          role="slider"
          aria-label={t('node.videoNode.position')}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${timeLabel(currentTime)} / ${timeLabel(duration)}`}
          aria-disabled={duration <= 0}
          tabIndex={0}
          className="relative flex h-5 min-w-4 flex-1 cursor-pointer touch-none items-center outline-none focus-visible:ring-1 focus-visible:ring-white"
          onPointerDown={startSeek}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            event.stopPropagation();
            seekTo(event.key === 'Home' ? 0 : event.key === 'End' ? duration : currentTime + (event.key === 'ArrowRight' ? 5 : -5));
          }}
        >
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
            <div className="h-full origin-left bg-white" style={{ transform: `scaleX(${duration > 0 ? Math.min(1, currentTime / duration) : 0})` }} />
          </div>
        </div>
        <span className="pointer-events-none whitespace-nowrap text-[10px] tabular-nums">{timeLabel(currentTime)} / {timeLabel(duration)}</span>
        <button type="button" aria-label={t(muted ? 'node.videoNode.unmute' : 'node.videoNode.mute')} onClick={() => {
          if (videoRef.current) videoRef.current.muted = !videoRef.current.muted;
        }}>
          {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
        </button>
        <button type="button" aria-label={t('node.videoNode.fullscreen')} onClick={() => {
          void containerRef.current?.requestFullscreen?.().catch(() => {});
        }}><Maximize2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
