/**
 * Reads one web page the user shared or pasted (Online on only). Only that page's address is
 * fetched: no search, no cookies, nothing about the user sent with it. Logic: page-logic.ts.
 */
import { USER_AGENT } from './lookup-logic';
import { extractPage, PAGE_LIMITS, readableUrl } from './page-logic';

export type Page = { url: string; title: string; text: string };

export type PageResult =
  { ok: true; page: Page } | { ok: false; reason: 'offline' | 'unreadable' | 'not-html' | 'empty' };

export async function fetchPage(url: string, doFetch: typeof fetch = fetch): Promise<PageResult> {
  if (!readableUrl(url)) return { ok: false, reason: 'unreadable' };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PAGE_LIMITS.timeoutMs);
  let res: Response;
  try {
    res = await doFetch(url, {
      signal: ctl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml', 'User-Agent': USER_AGENT },
      credentials: 'omit',
    });
  } catch {
    clearTimeout(timer);
    return { ok: false, reason: 'offline' };
  }
  try {
    if (!res.ok) return { ok: false, reason: 'unreadable' };
    const type = res.headers?.get?.('content-type') ?? 'text/html';
    if (!/html|xml|text\/plain/i.test(type)) return { ok: false, reason: 'not-html' };
    const body = (await res.text()).slice(0, PAGE_LIMITS.maxHtmlChars);
    const finalUrl = res.url || url;
    const { title, text } = /text\/plain/i.test(type)
      ? { title: '', text: body.slice(0, PAGE_LIMITS.maxTextChars) }
      : extractPage(body);
    if (text.trim().length < 80) return { ok: false, reason: 'empty' };
    return { ok: true, page: { url: finalUrl, title: title || finalUrl, text } };
  } catch {
    return { ok: false, reason: 'unreadable' };
  } finally {
    clearTimeout(timer);
  }
}
