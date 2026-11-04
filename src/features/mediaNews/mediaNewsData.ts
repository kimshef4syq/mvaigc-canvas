export const MEDIA_NEWS_URL = 'http://175.178.92.61/media-lab/';

export const MEDIA_NEWS_BRIDGE_PROTOCOL = 'mvaigc-media-news-link';

export function resolveExternalLink(rawHref: string | null | undefined): string | null {
  const href = rawHref?.trim();
  if (!href) {
    return null;
  }
  if (!/^https?:\/\//i.test(href)) {
    return null;
  }
  return href;
}

export function parseBridgeMessage(data: unknown): string | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const message = data as { protocol?: unknown; url?: unknown };
  if (message.protocol !== MEDIA_NEWS_BRIDGE_PROTOCOL) {
    return null;
  }
  return typeof message.url === 'string' ? resolveExternalLink(message.url) : null;
}

/**
 * The page is fetched over plain HTTP from a third party, so a tampered body
 * could post the bridge protocol itself. Only trust messages whose source is
 * our own sandboxed iframe.
 */
export function resolveBridgeLink(
  data: unknown,
  source: Window | null,
  iframeWindow: Window | null
): string | null {
  if (!iframeWindow || source !== iframeWindow) {
    return null;
  }
  return parseBridgeMessage(data);
}

const BRIDGE_SCRIPT = `<script>
(function () {
  document.addEventListener('click', function (event) {
    var anchor = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!anchor) return;
    var href = anchor.getAttribute('href') || '';
    if (!/^https?:\\/\\//i.test(href)) return;
    event.preventDefault();
    window.parent.postMessage({ protocol: '${MEDIA_NEWS_BRIDGE_PROTOCOL}', url: href }, '*');
  });
})();
</script>`;

export function injectLinkBridge(html: string): string {
  if (html.includes(MEDIA_NEWS_BRIDGE_PROTOCOL)) {
    return html;
  }
  if (html.includes('</body>')) {
    return html.replace('</body>', `${BRIDGE_SCRIPT}</body>`);
  }
  return `${html}${BRIDGE_SCRIPT}`;
}
