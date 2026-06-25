/**
 * Lightweight web search + fetch service for task tools.
 * Uses the built-in Node.js fetch (Node 18+).
 */

import { promises as dns } from 'dns';

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, '');
}

function safeFromCodePoint(cp: number): string {
  try {
    return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
  } catch {
    return '';
  }
}

/** Decode the common named + numeric HTML entities found in scraped markup. */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&(?:apos|#0*39);/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => safeFromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeFromCodePoint(parseInt(d, 10)))
    // &amp; last so a literal "&amp;lt;" doesn't double-decode into "<".
    .replace(/&amp;/g, '&');
}

/** Strip HTML to plain text: drop scripts/styles/tags, decode entities, collapse. */
export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<[^>]*>/g, ' ');
  s = decodeHtmlEntities(s);
  return s.replace(/\s+/g, ' ').trim().slice(0, 10_000);
}

/** Convert HTML to lightweight Markdown, preserving headings, links, emphasis,
 *  and list/paragraph structure (unlike the plain-text path which flattens it). */
export function htmlToMarkdown(html: string): string {
  let s = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, lvl: string, inner: string) =>
    `\n\n${'#'.repeat(Number(lvl))} ${stripTags(inner).trim()}\n\n`);
  s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, inner: string) => {
    const text = stripTags(inner).trim();
    return text ? `[${text}](${href})` : '';
  });
  s = s.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __: string, inner: string) => `**${stripTags(inner).trim()}**`);
  s = s.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __: string, inner: string) => `*${stripTags(inner).trim()}*`);
  s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_, inner: string) => `\n- ${stripTags(inner).trim()}`);
  s = s.replace(/<\/(p|div|section|article|header|footer|ul|ol|tr|h[1-6])>/gi, '\n\n');
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = stripTags(s);
  s = decodeHtmlEntities(s);
  return s.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, 10_000);
}

/**
 * Parse DuckDuckGo HTML results, keeping each title aligned with ITS OWN
 * snippet. The previous implementation collected links and snippets into two
 * separate lists and zipped them by index, so a single result missing a snippet
 * shifted every later snippet onto the wrong title. Here each result's snippet
 * is the first result__snippet that falls between this link and the next, or ''
 * when absent. Pure + exported for testing.
 */
export function parseDuckDuckGoResults(html: string, count: number): WebSearchResult[] {
  const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  const links = [...html.matchAll(linkRegex)];
  const snippets = [...html.matchAll(snippetRegex)];
  const results: WebSearchResult[] = [];
  for (let i = 0; i < links.length && results.length < count; i++) {
    const m = links[i];
    const start = m.index ?? 0;
    const end = i + 1 < links.length ? (links[i + 1].index ?? Number.MAX_SAFE_INTEGER) : Number.MAX_SAFE_INTEGER;
    const snip = snippets.find((s) => {
      const idx = s.index ?? -1;
      return idx > start && idx < end;
    });
    const rawUrl = m[1];
    const uddg = rawUrl.match(/uddg=([^&]+)/);
    results.push({
      title: decodeHtmlEntities(stripTags(m[2]).trim()),
      url: uddg ? decodeURIComponent(uddg[1]) : rawUrl,
      snippet: snip ? decodeHtmlEntities(stripTags(snip[1]).trim()) : '',
    });
  }
  return results;
}

/**
 * SSRF guard: only allow http(s) URLs whose hostname is a public, routable
 * address. Reject loopback, private, link-local, multicast, and reserved IPs
 * (including IPv4-mapped IPv6 addresses) as well as `file:` / `data:` / blob
 * schemes that would otherwise give the renderer a way to read local files.
 */
function assertSafeFetchUrl(rawUrl: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`拒绝抓取：URL 解析失败 (${rawUrl.slice(0, 80)})`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`拒绝抓取：协议 ${parsed.protocol} 不被允许（仅 http/https）`);
  }
  const host = parsed.hostname;
  if (!host) throw new Error('拒绝抓取：URL 缺少主机名');
  // Reject obvious local names without paying for a DNS lookup.
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) {
    throw new Error('拒绝抓取：localhost 不被允许');
  }
  // If the hostname is a literal IP, validate it directly. Otherwise (a real
  // domain) we trust the public DNS resolution and rely on fetch's own
  // network stack. Literal-IP checks cover the common SSRF patterns
  // (127.0.0.1, 169.254.169.254, 10.x, 192.168.x, ::1, fc00::/7, etc.).
  if (isLiteralIp(host) && !isPublicIp(host)) {
    throw new Error(`拒绝抓取：目标 IP ${host} 属于私网/保留段`);
  }
  return parsed;
}

function isLiteralIp(host: string): boolean {
  // IPv4: d.d.d.d; IPv6: contains ':' or is bracketed.
  if (host.includes(':')) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

/** Convert an IPv6 address to its full 8-group form. Best-effort. */
function expandIPv6(host: string): string {
  // Strip any surrounding brackets left by URL.hostname.
  let h = host.replace(/^\[|\]$/g, '').toLowerCase();
  // Handle IPv4-mapped (::ffff:a.b.c.d or ::ffff:a00:1) by expanding the
  // embedded IPv4 portion back to hex.
  h = h.replace(/^::ffff:(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, (_m, a, b, c, d) => {
    return `::ffff:${[a, b, c, d].map((n) => Number(n).toString(16).padStart(2, '0')).join(':')}`;
  });
  // Expand :: shorthand.
  if (h.includes('::')) {
    const [left, right] = h.split('::');
    const leftGroups = left ? left.split(':') : [];
    const rightGroups = right ? right.split(':') : [];
    const missing = 8 - (leftGroups.length + rightGroups.length);
    const pad = missing > 0 ? new Array(missing).fill('0') : [];
    h = [...leftGroups, ...pad, ...rightGroups].join(':');
  }
  // Pad each group to 4 hex chars.
  return h.split(':').map((g) => g.padStart(4, '0')).join(':');
}

function isPublicIp(host: string): boolean {
  if (host.includes(':')) {
    // IPv6: reject loopback (::1), unique-local (fc00::/7),
    // link-local (fe80::/10), unspecified (::), and IPv4-mapped.
    const expanded = expandIPv6(host);
    // The first 32 bits of an IPv4-mapped (::ffff:0:0/96) cover the IPv4 part.
    // After `::` expansion the tail may be either 4 IPv4-mapped hex groups OR
    // 2 groups holding a 32-bit value (the WHATWG compressed form, e.g.
    // `::ffff:a00:1` for 10.0.0.1). Handle both.
    if (expanded.startsWith('0000:0000:0000:0000:0000:ffff:')) {
      const tail = expanded.slice('0000:0000:0000:0000:0000:ffff:'.length);
      const groups = tail.split(':');
      let v4: string;
      if (groups.length === 4) {
        v4 = groups.map((g) => parseInt(g, 16)).join('.');
      } else if (groups.length === 2) {
        // Compressed 32-bit IPv4: high 16 bits + low 16 bits.
        const hi = parseInt(groups[0], 16);
        const lo = parseInt(groups[1], 16);
        v4 = `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
      } else {
        return true; // Unrecognized mapping; let the request through and let fetch fail.
      }
      return isPublicIp(v4);
    }
    // Unique-local fc00::/7 — first hextet is fc.. or fd.. (top 7 bits = 1111110x).
    const firstHextet = expanded.slice(0, 4);
    if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return false;
    // Link-local fe80::/10 — first 10 bits are 1111 1110 10.
    if (firstHextet === 'fe80') return false;
    // Loopback ::1 and unspecified ::.
    if (expanded === '0000:0000:0000:0000:0000:0000:0000:0001' || expanded === '0000:0000:0000:0000:0000:0000:0000:0000') return false;
    // Otherwise assume routable (true IPv6 public space).
    return true;
  }
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  if (a === 10) return false;                 // 10.0.0.0/8
  if (a === 127) return false;                // 127.0.0.0/8 loopback
  if (a === 0) return false;                  // 0.0.0.0/8
  if (a === 169 && b === 254) return false;   // 169.254.0.0/16 link-local
  if (a === 172 && b >= 16 && b <= 31) return false;  // 172.16.0.0/12
  if (a === 192 && b === 168) return false;   // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return false; // 100.64.0.0/10 CGN
  if (a >= 224) return false;                 // 224+ multicast / reserved
  return true;
}

/**
 * Resolve a hostname and verify EVERY resolved address is public, then return
 * the first public IP. This closes the DNS-rebinding gap: a domain that
 * resolves to a public IP at validation time but a private IP (or
 * 169.254.169.254) at fetch time is rejected because we resolve here and pin
 * the fetch to the resolved IP (see fetchUrl). Literal-IP hosts are validated
 * directly without a lookup.
 *
 * Returns { ip, port } where `ip` is a public, routable address we have
 * verified. Throws if any resolution is private/loopback/link-local.
 */
async function resolvePublicHost(hostname: string): Promise<string> {
  // Literal IP: validate directly, no lookup.
  if (isLiteralIp(hostname)) {
    if (!isPublicIp(hostname)) {
      throw new Error(`拒绝抓取：目标 IP ${hostname} 属于私网/保留段`);
    }
    return hostname;
  }
  // Hostname: resolve and require ALL A/AAAA records to be public. If any
  // record points at a private range, reject (an attacker commonly mixes a
  // public and a private record to slip past single-record checks).
  let addrs: string[];
  try {
    const [a, aaaa] = await Promise.all([
      dns.resolve4(hostname).catch(() => [] as string[]),
      dns.resolve6(hostname).catch(() => [] as string[]),
    ]);
    addrs = [...a, ...aaaa];
  } catch {
    throw new Error(`拒绝抓取：无法解析主机名 ${hostname}`);
  }
  if (addrs.length === 0) {
    throw new Error(`拒绝抓取：主机名 ${hostname} 无 DNS 记录`);
  }
  for (const ip of addrs) {
    if (!isPublicIp(ip)) {
      throw new Error(`拒绝抓取：主机名 ${hostname} 解析到私网/保留地址 ${ip}`);
    }
  }
  // Pin to the first verified public IP. Caller rewrites the URL to this IP
  // and sets the original Host header so virtual-hosted servers route correctly.
  return addrs[0];
}

export class WebService {
  /**
   * Web search. Currently uses DuckDuckGo's HTML endpoint (no API key needed).
   * In production, you'd swap this with Tavily, Brave, Google, etc.
   */
  async search(query: string, count: number = 5): Promise<WebSearchResult[]> {
    try {
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Code-IDE/1.0)',
        },
        signal: AbortSignal.timeout(10_000),
      });
      const html = await res.text();
      return parseDuckDuckGoResults(html, count);
    } catch (e: any) {
      return [{ title: '搜索失败', url: '', snippet: e.message }];
    }
  }

  /**
   * Fetch a URL and extract readable text. Defends against SSRF by:
   *   - validating scheme/host on every hop (including redirects),
   *   - resolving the hostname ourselves and requiring ALL resolved IPs to be
   *     public (DNS-rebinding defense), pinning plain-HTTP requests to the
   *     resolved IP,
   *   - following redirects manually with a small hop cap so a public URL that
   *     302s to an internal address is still validated.
   *
   * Note: for HTTPS we resolve+validate pre-flight but cannot rewrite the host
   * (TLS/SNI + cert validation require the original hostname), so a narrow
   * DNS-rebinding TOCTOU remains for HTTPS targets. The pre-flight check still
   * defeats the common case (static private DNS records, IP-encoded domains).
   */
  async fetchUrl(url: string, extractMode: 'markdown' | 'text' = 'markdown'): Promise<string> {
    const MAX_REDIRECTS = 5;
    let currentUrl = url;
    try {
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        // Validate scheme + hostname format (rejects file:/data:/localhost).
        const parsed = assertSafeFetchUrl(currentUrl);
        // Resolve and verify the host is public. For plain HTTP we additionally
        // pin the request to the resolved IP + send the original Host header.
        const pinnedIp = await resolvePublicHost(parsed.hostname);
        const usePin = parsed.protocol === 'http:';
        const fetchUrlStr = usePin ? (() => {
          const u = new URL(currentUrl);
          u.hostname = pinnedIp.includes(':') ? `[${pinnedIp}]` : pinnedIp;
          return u.toString();
        })() : currentUrl;

        const headers: Record<string, string> = {
          'User-Agent': 'Mozilla/5.0 (compatible; Code-IDE/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        };
        if (usePin) headers['Host'] = parsed.host; // keep original host/port for vhost routing

        const res = await fetch(fetchUrlStr, {
          headers,
          signal: AbortSignal.timeout(15_000),
          redirect: 'manual',
        });

        // Manual redirect handling: re-validate every Location target.
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get('location');
          if (!location) {
            throw new Error('重定向缺少 Location 头');
          }
          currentUrl = new URL(location, currentUrl).toString(); // support relative redirects
          continue;
        }

        const contentType = res.headers.get('content-type') || '';
        const body = await res.text();
        if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
          return this.extractText(body, extractMode);
        }
        // Plain text or other — return as-is, truncated
        return body.slice(0, 10_000);
      }
      throw new Error('重定向次数超过上限');
    } catch (e: any) {
      return `抓取失败：${e.message}`;
    }
  }

  private extractText(html: string, mode: 'markdown' | 'text'): string {
    return mode === 'markdown' ? htmlToMarkdown(html) : htmlToPlainText(html);
  }
}
