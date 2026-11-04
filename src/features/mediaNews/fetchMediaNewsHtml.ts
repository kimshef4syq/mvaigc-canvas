import { customHttpRequest } from '@/commands/ai';
import { MEDIA_NEWS_URL } from './mediaNewsData';

export async function fetchMediaNewsHtml(): Promise<string> {
  const response = await customHttpRequest({
    url: MEDIA_NEWS_URL,
    method: 'GET',
    timeoutMs: 30_000,
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = response.text?.trim();
  if (!html) {
    throw new Error('empty response');
  }

  return html;
}
