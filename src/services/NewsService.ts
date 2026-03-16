import { NewsItem, SentimentLabel, NewsImpact } from "../types/news";

const CRYPTO_COMPARE_URL = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest";
const RSS_PROXY = "https://api.allorigins.win/raw?url=";
const FETCH_TIMEOUT = 10000;
const MAX_NEWS_ITEMS = 18;

const POSITIVE_KEYWORDS = ["bull", "surge", "rally", "gain", "rise", "growth", "recover", "pump", "breakout", "upgrade", "adoption"];
const NEGATIVE_KEYWORDS = ["bear", "crash", "drop", "fall", "decline", "loss", "dump", "fear", "risk", "warn", "plunge", "hack", "ban"];

const RSS_SOURCES = [
  { channel: "CoinDesk", url: "https://www.coindesk.com/arc/outboundfeeds/rss/" },
  { channel: "Cointelegraph", url: "https://cointelegraph.com/rss" },
  { channel: "AMBCrypto", url: "https://ambcrypto.com/feed/" },
  { channel: "crypto.news", url: "https://crypto.news/feed/" },
];

function mapAsset(text: string): NewsItem["asset"] {
  const lower = text.toLowerCase();
  if (lower.includes("bitcoin") || lower.includes("btc")) return "BTC";
  if (lower.includes("ethereum") || lower.includes("eth")) return "ETH";
  if (lower.includes("gold") || lower.includes("paxg") || lower.includes("vàng")) return "PAXG";
  return "general";
}

function analyzeSentiment(title: string, body: string): { sentiment: SentimentLabel; confidence: number } {
  const text = (title + " " + (body || "")).toLowerCase();
  const pos = POSITIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  const neg = NEGATIVE_KEYWORDS.filter((w) => text.includes(w)).length;
  const total = pos + neg || 1;
  const score = Math.round((pos / total) * 100);

  let sentiment: SentimentLabel = "neutral";
  if (score > 60) sentiment = "positive";
  else if (score < 40) sentiment = "negative";

  const confidence = Math.min(95, Math.max(30, 40 + Math.abs(pos - neg) * 10));
  return { sentiment, confidence };
}

function estimateImpact(title: string): NewsImpact {
  const lower = title.toLowerCase();
  const highImpact = ["crash", "ban", "hack", "regulation", "fed", "etf", "halving", "war"];
  const medImpact = ["surge", "rally", "drop", "upgrade", "fork", "adoption"];
  if (highImpact.some((w) => lower.includes(w))) return "high";
  if (medImpact.some((w) => lower.includes(w))) return "medium";
  return "low";
}

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeNewsItems(items: NewsItem[]): NewsItem[] {
  const deduped: NewsItem[] = [];
  for (const item of items) {
    const normalized = normalizeTitle(item.title);
    const exists = deduped.some((existing) => {
      if (item.url && existing.url && item.url === existing.url) return true;
      return normalizeTitle(existing.title) === normalized;
    });
    if (!exists) deduped.push(item);
  }
  return deduped.sort((a, b) => b.publishedAt - a.publishedAt);
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
        this.fetchCryptoCompare(),
        ...RSS_SOURCES.map((source) => this.fetchRSSSource(source.channel, source.url)),
      ]);

      const merged = results
        .filter((result): result is PromiseFulfilledResult<NewsItem[]> => result.status === "fulfilled")
        .flatMap((result) => result.value);

      this.cache = dedupeNewsItems(merged).slice(0, MAX_NEWS_ITEMS);
      this.lastFetchAt = Date.now();
      return this.cache;
    } catch (e) {
      console.warn("[NewsService] Failed to fetch news:", e);
      return this.cache;
    }
  }

  getCachedNews(): NewsItem[] {
    return this.cache;
  }

  private async fetchCryptoCompare(): Promise<NewsItem[]> {
    const res = await this.fetchJson(CRYPTO_COMPARE_URL);
    const data = await res.json();
    const articles = (data.Data || []).slice(0, 8);

    return articles.map((a: any, i: number): NewsItem => {
      const title = a.title || "Untitled";
      const summary = stripHtml((a.body || "").slice(0, 260));
      const { sentiment, confidence } = analyzeSentiment(title, summary);
      return {
        id: `cryptocompare-${a.id || i}`,
        asset: mapAsset(title + " " + (a.categories || "")),
        title,
        summary,
        source: a.source_info?.name || a.source || "CryptoCompare",
        channel: "CryptoCompare",
        url: a.url,
        publishedAt: (a.published_on || 0) * 1000,
        sentiment,
        confidence,
        impact: estimateImpact(title),
      };
    });
  }

  private async fetchRSSSource(channel: string, url: string): Promise<NewsItem[]> {
    const proxiedUrl = `${RSS_PROXY}${encodeURIComponent(url)}`;
    const res = await this.fetchJson(proxiedUrl);
    const xmlText = await res.text();
    return this.parseRSS(xmlText, channel);
  }

  private parseRSS(xmlText: string, channel: string): NewsItem[] {
    if (typeof DOMParser === "undefined") return [];

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");
    const items = Array.from(xml.querySelectorAll("item")).slice(0, 5);

    return items.map((item, index): NewsItem => {
      const title = item.querySelector("title")?.textContent?.trim() || `${channel} article ${index + 1}`;
      const summary = stripHtml(
        item.querySelector("description")?.textContent ||
        item.querySelector("content\\:encoded")?.textContent ||
        ""
      ).slice(0, 260);
      const publishedRaw =
        item.querySelector("pubDate")?.textContent ||
        item.querySelector("dc\\:date")?.textContent ||
        "";
      const publishedAt = Date.parse(publishedRaw) || Date.now() - index * 60000;
      const url = item.querySelector("link")?.textContent?.trim() || undefined;
      const categoryText = Array.from(item.querySelectorAll("category"))
        .map((node) => node.textContent || "")
        .join(" ");
      const source =
        item.querySelector("source")?.textContent?.trim() ||
        channel;
      const { sentiment, confidence } = analyzeSentiment(title, summary);

      return {
        id: `${channel.toLowerCase().replace(/\s+/g, "-")}-${publishedAt}-${index}`,
        asset: mapAsset(`${title} ${summary} ${categoryText}`),
        title,
        summary,
        source,
        channel,
        url,
        publishedAt,
        sentiment,
        confidence,
        impact: estimateImpact(title),
      };
    });
  }

  private async fetchJson(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`News API ${res.status}`);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
