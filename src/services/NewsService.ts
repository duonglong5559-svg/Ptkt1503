import { NewsItem, SentimentLabel, NewsImpact } from "../types/news";

const CRYPTO_COMPARE_URL = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest";
const FETCH_TIMEOUT = 10000;
const RSS_PROXY_URL = "https://api.allorigins.win/raw?url=";
const MAX_NEWS_ITEMS = 12;

type RssSourceConfig = {
  name: string;
  url: string;
};

const RSS_SOURCES: RssSourceConfig[] = [
  {
    name: "CoinDesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
  },
  {
    name: "Cointelegraph Markets",
    url: "https://cointelegraph.com/rss/tag/markets",
  },
  {
    name: "Investing Crypto",
    url: "https://www.investing.com/rss/news_301.rss",
  },
];

const POSITIVE_KEYWORDS = ["bull", "surge", "rally", "gain", "rise", "growth", "recover", "pump", "breakout", "upgrade", "adoption"];
const NEGATIVE_KEYWORDS = ["bear", "crash", "drop", "fall", "decline", "loss", "dump", "fear", "risk", "warn", "plunge", "hack", "ban"];
const PRICE_RELEVANCE_KEYWORDS = [
  "price", "market", "markets", "analysis", "support", "resistance",
  "breakout", "breakdown", "liquidation", "volume", "etf", "fed",
  "inflation", "btc", "bitcoin", "eth", "ethereum", "gold", "paxg",
];

export function mapAsset(text: string): NewsItem["asset"] {
  const lower = text.toLowerCase();
  if (lower.includes("bitcoin") || lower.includes("btc")) return "BTC";
  if (lower.includes("ethereum") || lower.includes("eth")) return "ETH";
  if (lower.includes("gold") || lower.includes("paxg") || lower.includes("vàng")) return "PAXG";
  return "general";
}

export function analyzeSentiment(title: string, body: string): { sentiment: SentimentLabel; confidence: number } {
  const text = (title + " " + (body || "")).toLowerCase();
  const pos = POSITIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  const neg = NEGATIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  const total = pos + neg;
  if (total === 0) {
    return { sentiment: "neutral", confidence: 35 };
  }
  const score = Math.round((pos / total) * 100);

  let sentiment: SentimentLabel = "neutral";
  if (score > 60) sentiment = "positive";
  else if (score < 40) sentiment = "negative";

  const confidence = Math.min(95, Math.max(30, 40 + Math.abs(pos - neg) * 10));
  return { sentiment, confidence };
}

export function estimateImpact(title: string): NewsImpact {
  const lower = title.toLowerCase();
  const highImpact = ["crash", "ban", "hack", "regulation", "fed", "etf", "halving", "war"];
  const medImpact = ["surge", "rally", "drop", "upgrade", "fork", "adoption"];
  if (highImpact.some((w) => lower.includes(w))) return "high";
  if (medImpact.some((w) => lower.includes(w))) return "medium";
  return "low";
}

export class NewsService {
  private cache: NewsItem[] = [];
  private lastFetchAt = 0;
  private cacheMaxAge = 5 * 60 * 1000;

  async fetchNews(): Promise<NewsItem[]> {
    if (this.cache.length > 0 && Date.now() - this.lastFetchAt < this.cacheMaxAge) {
      return this.cache;
    }

    try {
      const results = await Promise.allSettled([
        this.fetchCryptoCompareNews(),
        ...RSS_SOURCES.map((source) => this.fetchRssNews(source)),
      ]);

      const combined = results.flatMap((result) =>
        result.status === "fulfilled" ? result.value : []
      );

      if (combined.length > 0) {
        this.cache = this.rankAndDedupeNews(combined).slice(0, MAX_NEWS_ITEMS);
        this.lastFetchAt = Date.now();
      }

      return this.cache;
    } catch (e) {
      console.warn("[NewsService] Failed to fetch news:", e);
      return this.cache;
    }
  }

  getCachedNews(): NewsItem[] {
    return this.cache;
  }

  private async fetchCryptoCompareNews(): Promise<NewsItem[]> {
    const res = await this.fetchWithTimeout(CRYPTO_COMPARE_URL);
    if (!res.ok) throw new Error(`News API ${res.status}`);
    const data = await res.json() as { Data?: any[] };
    const articles = (data.Data || []).slice(0, 8);

    return articles.map((a: any, i: number): NewsItem => {
      const { sentiment, confidence } = analyzeSentiment(a.title, a.body);
      return {
        id: `news-${a.id || i}`,
        asset: mapAsset(a.title + " " + (a.categories || "")),
        title: a.title,
        summary: (a.body || "").slice(0, 200),
        source: a.source_info?.name || a.source || "CryptoCompare",
        publishedAt: (a.published_on || 0) * 1000,
        url: a.url,
        categories: typeof a.categories === "string" ? a.categories.split("|").filter(Boolean) : [],
        sentiment,
        confidence,
        impact: estimateImpact(a.title),
      };
    });
  }

  private async fetchRssNews(source: RssSourceConfig): Promise<NewsItem[]> {
    const proxyUrl = `${RSS_PROXY_URL}${encodeURIComponent(source.url)}`;
    const res = await this.fetchWithTimeout(proxyUrl);
    if (!res.ok) throw new Error(`${source.name} RSS ${res.status}`);
    const xml = await res.text();
    return this.parseRssFeed(xml, source);
  }

  private async fetchWithTimeout(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      return await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  private parseRssFeed(xml: string, source: RssSourceConfig): NewsItem[] {
    const items = xml.match(/<item\b[\s\S]*?<\/item>/gi) || [];
    return items.slice(0, 8).map((item, idx) => {
      const title = this.cleanXmlValue(this.extractSingleTag(item, "title"));
      const summary = this.cleanXmlValue(this.extractSingleTag(item, "description"));
      const url = this.cleanXmlValue(this.extractSingleTag(item, "link"));
      const publishedAt = Date.parse(this.cleanXmlValue(this.extractSingleTag(item, "pubDate"))) || Date.now();
      const categories = this.extractMultiTag(item, "category").map((value) => this.cleanXmlValue(value)).filter(Boolean);
      const { sentiment, confidence } = analyzeSentiment(title, summary);

      return {
        id: `rss-${source.name}-${idx}-${publishedAt}`,
        asset: mapAsset(`${title} ${summary} ${categories.join(" ")}`),
        title,
        summary: summary.slice(0, 220),
        source: source.name,
        publishedAt,
        url,
        categories,
        sentiment,
        confidence,
        impact: estimateImpact(title),
      };
    }).filter((item) => item.title.length > 0);
  }

  private extractSingleTag(block: string, tag: string): string {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return match?.[1] || "";
  }

  private extractMultiTag(block: string, tag: string): string[] {
    return Array.from(block.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))).map((match) => match[1] || "");
  }

  private cleanXmlValue(value: string): string {
    return this.decodeHtmlEntities(
      value
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    );
  }

  private decodeHtmlEntities(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, "\"")
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private rankAndDedupeNews(items: NewsItem[]): NewsItem[] {
    const deduped = new Map<string, NewsItem>();

    for (const item of items) {
      const key = (item.url || this.normalizeTitle(item.title)).toLowerCase();
      const existing = deduped.get(key);
      if (!existing || this.computePriority(item) > this.computePriority(existing)) {
        deduped.set(key, item);
      }
    }

    return Array.from(deduped.values()).sort((a, b) => {
      const diff = this.computePriority(b) - this.computePriority(a);
      if (diff !== 0) return diff;
      return b.publishedAt - a.publishedAt;
    });
  }

  private computePriority(item: NewsItem): number {
    const text = `${item.title} ${item.summary} ${(item.categories || []).join(" ")}`.toLowerCase();
    const keywordHits = PRICE_RELEVANCE_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
    const impactBoost = item.impact === "high" ? 35 : item.impact === "medium" ? 20 : 8;
    const assetBoost = item.asset === "general" ? 6 : 14;
    const sourceBoost = item.source.includes("Investing") ? 16 : item.source.includes("Cointelegraph") ? 14 : item.source.includes("CoinDesk") ? 10 : 8;
    const freshnessHours = Math.max(0, (Date.now() - item.publishedAt) / (60 * 60 * 1000));
    const freshnessBoost = freshnessHours < 6 ? 20 : freshnessHours < 24 ? 12 : freshnessHours < 48 ? 6 : 0;
    return impactBoost + assetBoost + sourceBoost + freshnessBoost + keywordHits * 4 + item.confidence * 0.1;
  }

  private normalizeTitle(title: string): string {
    return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }
}
