/**
 * Lightweight web search + fetch service for task tools.
 * Uses the built-in Node.js fetch (Node 18+).
 */

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
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

      // Basic extraction of result links and snippets from DDG HTML
      const results: WebSearchResult[] = [];
      const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
      const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

      const links: { title: string; rawUrl: string }[] = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null && links.length < count) {
        const rawUrl = match[1];
        // DDG wraps URLs in a redirect
        const urlMatch = rawUrl.match(/uddg=([^&]+)/);
        links.push({ title: match[2].replace(/<[^>]*>/g, '').trim(), rawUrl: urlMatch ? decodeURIComponent(urlMatch[1]) : rawUrl });
      }

      const snippets: string[] = [];
      snippetRegex.lastIndex = 0;
      while ((match = snippetRegex.exec(html)) !== null && snippets.length < count) {
        snippets.push(match[1].replace(/<[^>]*>/g, '').trim());
      }

      for (let i = 0; i < Math.min(links.length, snippets.length); i++) {
        results.push({
          title: links[i].title,
          url: links[i].rawUrl,
          snippet: snippets[i],
        });
      }
      return results;
    } catch (e: any) {
      return [{ title: '搜索失败', url: '', snippet: e.message }];
    }
  }

  /** Fetch a URL and extract readable text. */
  async fetchUrl(url: string, extractMode: 'markdown' | 'text' = 'markdown'): Promise<string> {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Code-IDE/1.0)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(15_000),
        redirect: 'follow',
      });

      const contentType = res.headers.get('content-type') || '';
      const body = await res.text();

      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        return this.extractText(body, extractMode);
      }
      // Plain text or other — return as-is, truncated
      return body.slice(0, 10_000);
    } catch (e: any) {
      return `抓取失败：${e.message}`;
    }
  }

  private extractText(html: string, mode: 'markdown' | 'text'): string {
    // Strip scripts and styles
    let cleaned = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    // Strip tags
    cleaned = cleaned.replace(/<[^>]*>/g, ' ');
    // Collapse whitespace
    cleaned = cleaned.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    return cleaned.slice(0, 10_000);
  }
}
