import { describe, it, expect } from 'vitest';
import {
  WebService,
  parseDuckDuckGoResults,
  htmlToPlainText,
  htmlToMarkdown,
  decodeHtmlEntities,
} from './web-service';

// SSRF guard unit tests for the WebService.fetchUrl path. We only assert on
// the failure strings the service emits — successful fetches would require
// network or fetch mocks which would obscure the actual security boundary.
describe('WebService.fetchUrl SSRF guard', () => {
  const svc = new WebService();

  it('rejects file: scheme', async () => {
    const r = await svc.fetchUrl('file:///etc/passwd');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects data: scheme', async () => {
    const r = await svc.fetchUrl('data:text/html,<script>alert(1)</script>');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects javascript: scheme', async () => {
    const r = await svc.fetchUrl('javascript:alert(1)');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects localhost by name', async () => {
    const r = await svc.fetchUrl('http://localhost:3000/admin');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects loopback IPv4 literal', async () => {
    const r = await svc.fetchUrl('http://127.0.0.1/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects 10.0.0.0/8 private', async () => {
    const r = await svc.fetchUrl('http://10.0.0.1/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects 192.168.0.0/16 private', async () => {
    const r = await svc.fetchUrl('http://192.168.1.1/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects 172.16.0.0/12 private', async () => {
    const r = await svc.fetchUrl('http://172.20.5.5/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects 169.254.0.0/16 link-local (cloud metadata)', async () => {
    const r = await svc.fetchUrl('http://169.254.169.254/latest/meta-data/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects IPv6 loopback ::1', async () => {
    const r = await svc.fetchUrl('http://[::1]/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects IPv6 unique-local fc00::/7', async () => {
    const r = await svc.fetchUrl('http://[fc00::1]/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects IPv6 link-local fe80::/10', async () => {
    const r = await svc.fetchUrl('http://[fe80::1]/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects IPv4-mapped IPv6 (::ffff:10.0.0.1)', async () => {
    const r = await svc.fetchUrl('http://[::ffff:10.0.0.1]/');
    expect(r).toMatch(/拒绝抓取/);
  });
  it('rejects unparseable URLs', async () => {
    const r = await svc.fetchUrl('not a url');
    expect(r).toMatch(/拒绝抓取/);
  });
  // For a public domain the guard passes and fetch is attempted. We can't
  // assert the result here (network-dependent) but we can assert that the
  // failure message does NOT start with "拒绝抓取" — proving the guard
  // let the request through to the actual fetch call.
  it('lets a public domain through to fetch', async () => {
    const r = await svc.fetchUrl('https://example.com/');
    expect(r.startsWith('拒绝抓取')).toBe(false);
  });
});

describe('parseDuckDuckGoResults', () => {
  // 3 results where the 2nd has NO snippet. The old zip-by-index parser shifted
  // result C's snippet onto B; this asserts each title keeps its own snippet.
  const html = [
    '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fa.com">Title A</a>',
    '<a class="result__snippet">Snippet A</a>',
    '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fb.com">Title B</a>',
    '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fc.com">Title C</a>',
    '<a class="result__snippet">Snippet C</a>',
  ].join('\n');

  it('keeps each title aligned with its own snippet (missing → empty)', () => {
    const out = parseDuckDuckGoResults(html, 5);
    expect(out).toEqual([
      { title: 'Title A', url: 'https://a.com', snippet: 'Snippet A' },
      { title: 'Title B', url: 'https://b.com', snippet: '' },
      { title: 'Title C', url: 'https://c.com', snippet: 'Snippet C' },
    ]);
  });

  it('respects the count cap and decodes the uddg redirect URL', () => {
    const out = parseDuckDuckGoResults(html, 2);
    expect(out).toHaveLength(2);
    expect(out[1].url).toBe('https://b.com');
  });
});

describe('decodeHtmlEntities', () => {
  it('decodes named and numeric (decimal + hex) entities', () => {
    expect(decodeHtmlEntities('a &amp; b &#39;q&#39; &lt;x&gt; &#x41;')).toBe("a & b 'q' <x> A");
  });
});

describe('extract modes (htmlToMarkdown vs htmlToPlainText)', () => {
  const html =
    '<h1>Title</h1><p>Hello <a href="https://x.com">link</a> &amp; <strong>bold</strong>.</p>';

  it('markdown preserves heading/link/emphasis structure', () => {
    const md = htmlToMarkdown(html);
    expect(md).toContain('# Title');
    expect(md).toContain('[link](https://x.com)');
    expect(md).toContain('**bold**');
  });

  it('text flattens to plain prose (no markdown markers) and decodes entities', () => {
    const txt = htmlToPlainText(html);
    expect(txt).not.toContain('#');
    expect(txt).not.toContain('](');
    expect(txt).not.toContain('**');
    expect(txt).toContain('link');
    expect(txt).toContain('& bold');
  });
});
