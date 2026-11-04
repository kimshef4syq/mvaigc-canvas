import { beforeEach, describe, expect, it, vi } from 'vitest';

const requestMock = vi.hoisted(() => vi.fn());

vi.mock('@/commands/ai', () => ({
  customHttpRequest: requestMock,
}));

import { fetchMediaNewsHtml } from './fetchMediaNewsHtml';
import { MEDIA_NEWS_URL } from './mediaNewsData';

beforeEach(() => {
  requestMock.mockReset();
});

describe('fetchMediaNewsHtml', () => {
  it('fetches the media lab page through the rust http bridge and returns its html', async () => {
    requestMock.mockResolvedValue({ status: 200, text: '<html><body>news</body></html>' });

    const html = await fetchMediaNewsHtml();

    expect(html).toBe('<html><body>news</body></html>');
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ url: MEDIA_NEWS_URL, method: 'GET' })
    );
  });

  it('throws with the status code when the page responds with an error', async () => {
    requestMock.mockResolvedValue({ status: 502, text: 'bad gateway' });

    await expect(fetchMediaNewsHtml()).rejects.toThrow('502');
  });

  it('throws when the response body is empty', async () => {
    requestMock.mockResolvedValue({ status: 200, text: '   ' });

    await expect(fetchMediaNewsHtml()).rejects.toThrow();
  });
});
