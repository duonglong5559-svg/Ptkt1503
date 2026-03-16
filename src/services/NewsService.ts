import { NewsItem, SentimentLabel, NewsImpact } from "../types/news";

const CRYPTO_COMPARE_URL = "https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest";
const FETCH_TIMEOUT = 10000;

const POSITIVE_KEYWORDS = ["bull", "surge", "rally", "gain", "rise", "growth", "recover", "pump", "breakout", "upgrade", "adoption"];
const NEGATIVE_KEYWORDS = ["bear", "crash", "drop", "fall", "decline", "loss", "dump", "fear", "risk", "warn", "plunge", "hack", "ban"];

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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
      const res = await fetch(CRYPTO_COMPARE_URL, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) throw new Error(`News API ${res.status}`);
      const data = await res.json() as { Data?: any[] };
      const articles = (data.Data || []).slice(0, 8);

      this.cache = articles.map((a: any, i: number): NewsItem => {
        const { sentiment, confidence } = analyzeSentiment(a.title, a.body);
        return {
          id: `news-${a.id || i}`,
          asset: mapAsset(a.title + " " + (a.categories || "")),
          title: a.title,
          summary: (a.body || "").slice(0, 200),
          source: a.source_info?.name || a.source || "Unknown",
          publishedAt: (a.published_on || 0) * 1000,
          url: a.url,
          categories: typeof a.categories === "string" ? a.categories.split("|").filter(Boolean) : [],
          sentiment,
          confidence,
          impact: estimateImpact(a.title),
        };
      });
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
}
