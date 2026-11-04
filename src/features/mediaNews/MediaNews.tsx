import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openUrl } from '@tauri-apps/plugin-opener';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { UiButton } from '@/components/ui';
import { fetchMediaNewsHtml } from './fetchMediaNewsHtml';
import { injectLinkBridge, resolveBridgeLink } from './mediaNewsData';

export function MediaNews() {
  const { t } = useTranslation();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const requestIdRef = useRef(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const load = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchMediaNewsHtml();
      if (requestIdRef.current !== requestId) {
        return;
      }
      setHtml(injectLinkBridge(fetched));
    } catch (err) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (requestIdRef.current === requestId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const url = resolveBridgeLink(
        event.data,
        event.source as Window | null,
        iframeRef.current?.contentWindow ?? null
      );
      if (url) {
        void openUrl(url).catch(() => undefined);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-dark">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border-dark px-4 py-2 sm:px-6">
        <p className="truncate text-xs text-text-muted">{t('mediaNews.description')}</p>
        <UiButton
          type="button"
          variant="muted"
          size="sm"
          onClick={() => void load()}
          disabled={loading}
          className="shrink-0 gap-2"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin motion-reduce:animate-none' : ''}`} />
          {t('mediaNews.refresh')}
        </UiButton>
      </div>

      <div className="relative min-h-0 flex-1">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <TriangleAlert className="h-5 w-5 text-text-muted" />
            <p className="text-sm text-text-dark">{t('mediaNews.loadFailed')}</p>
            <p className="max-w-md break-all text-xs text-text-muted">{error}</p>
            <UiButton type="button" variant="muted" size="sm" onClick={() => void load()}>
              {t('mediaNews.retry')}
            </UiButton>
          </div>
        ) : html ? (
          <iframe
            ref={iframeRef}
            title={t('mediaNews.title')}
            srcDoc={html}
            sandbox="allow-scripts"
            className="h-full w-full border-0 bg-white"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-text-muted">
            {t('common.loading')}
          </div>
        )}
      </div>
    </div>
  );
}
