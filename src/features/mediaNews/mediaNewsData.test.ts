import { describe, expect, it } from 'vitest';
import {
  MEDIA_NEWS_BRIDGE_PROTOCOL,
  injectLinkBridge,
  parseBridgeMessage,
  resolveBridgeLink,
  resolveExternalLink,
} from './mediaNewsData';

function extractBridgeScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('expected injectLinkBridge to insert an inline script');
  }
  return match[1];
}

function runBridgeScript(html: string) {
  const script = extractBridgeScript(html);
  const listeners: Array<{ type: string; handler: (event: unknown) => void }> = [];
  const posted: unknown[] = [];
  const fakeDocument = {
    addEventListener: (type: string, handler: (event: unknown) => void) => {
      listeners.push({ type, handler });
    },
  };
  const fakeWindow = {
    parent: {
      postMessage: (message: unknown) => {
        posted.push(message);
      },
    },
  };

  new Function('document', 'window', script)(fakeDocument, fakeWindow);
  return { listeners, posted };
}

describe('injectLinkBridge', () => {
  it('inserts the bridge script before the closing body tag', () => {
    const html = injectLinkBridge('<html><body><p>hi</p></body></html>');

    expect(html).toContain('<p>hi</p>');
    expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<p>hi</p>'));
    expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</body>'));
  });

  it('still injects the bridge when the document has no body tag', () => {
    const html = injectLinkBridge('<p>bare</p>');

    expect(html).toContain('<p>bare</p>');
    expect(extractBridgeScript(html)).toContain('postMessage');
  });

  it('does not inject a second copy when the bridge is already present', () => {
    const once = injectLinkBridge('<html><body></body></html>');
    const twice = injectLinkBridge(once);

    expect(twice.match(/<script>/g)).toHaveLength(1);
  });
});

describe('media news link bridge', () => {
  it('forwards an http link click to the parent window instead of navigating', () => {
    const { listeners, posted } = runBridgeScript(
      injectLinkBridge('<html><body><a href="https://example.com/a">x</a></body></html>')
    );
    const click = listeners.find((listener) => listener.type === 'click');
    expect(click).toBeDefined();

    let prevented = false;
    click?.handler({
      target: { closest: () => ({ getAttribute: () => 'https://example.com/a' }) },
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(true);
    expect(posted).toEqual([
      { protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'https://example.com/a' },
    ]);
  });

  it('ignores clicks that are not on an anchor', () => {
    const { listeners, posted } = runBridgeScript(injectLinkBridge('<html><body></body></html>'));
    const click = listeners.find((listener) => listener.type === 'click');

    let prevented = false;
    click?.handler({
      target: { closest: () => null },
      preventDefault: () => {
        prevented = true;
      },
    });

    expect(prevented).toBe(false);
    expect(posted).toEqual([]);
  });
});

describe('resolveExternalLink', () => {
  it('returns the href for http and https links', () => {
    expect(resolveExternalLink('http://m.tvoao.com/news/223145.html')).toBe(
      'http://m.tvoao.com/news/223145.html'
    );
    expect(resolveExternalLink(' https://example.com/a ')).toBe('https://example.com/a');
  });

  it('rejects non-http schemes and empty input', () => {
    expect(resolveExternalLink('javascript:alert(1)')).toBeNull();
    expect(resolveExternalLink('data:text/html,<p>x</p>')).toBeNull();
    expect(resolveExternalLink('')).toBeNull();
    expect(resolveExternalLink(null)).toBeNull();
    expect(resolveExternalLink(undefined)).toBeNull();
  });
});

describe('parseBridgeMessage', () => {
  it('accepts a message from the bridge and returns its url', () => {
    expect(
      parseBridgeMessage({
        protocol: MEDIA_NEWS_BRIDGE_PROTOCOL,
        url: 'https://example.com/a',
      })
    ).toBe('https://example.com/a');
  });

  it('ignores messages from other protocols, shapes, or unsafe urls', () => {
    expect(parseBridgeMessage({ protocol: 'something-else', url: 'https://example.com' })).toBeNull();
    expect(parseBridgeMessage({ url: 'https://example.com' })).toBeNull();
    expect(parseBridgeMessage('https://example.com')).toBeNull();
    expect(parseBridgeMessage(null)).toBeNull();
    expect(
      parseBridgeMessage({ protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'javascript:alert(1)' })
    ).toBeNull();
  });
});

describe('resolveBridgeLink', () => {
  const iframeWindow = {} as Window;

  it('accepts a well-formed message that came from our own iframe', () => {
    expect(
      resolveBridgeLink(
        { protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'https://example.com/a' },
        iframeWindow,
        iframeWindow
      )
    ).toBe('https://example.com/a');
  });

  it('rejects a well-formed message from any other window', () => {
    const attacker = {} as Window;

    expect(
      resolveBridgeLink(
        { protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'https://evil.example/x' },
        attacker,
        iframeWindow
      )
    ).toBeNull();
  });

  it('rejects everything when the iframe window is not mounted yet', () => {
    expect(
      resolveBridgeLink(
        { protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'https://example.com/a' },
        iframeWindow,
        null
      )
    ).toBeNull();
  });

  it('rejects a message from our iframe when the url is unsafe', () => {
    expect(
      resolveBridgeLink(
        { protocol: MEDIA_NEWS_BRIDGE_PROTOCOL, url: 'javascript:alert(1)' },
        iframeWindow,
        iframeWindow
      )
    ).toBeNull();
  });
});
