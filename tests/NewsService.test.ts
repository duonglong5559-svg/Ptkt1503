import { AssertFn } from "./helpers";
import { dedupeNewsItems } from "../src/services/NewsService";
import { NewsItem } from "../src/types";

function makeNews(overrides: Partial<NewsItem> & Pick<NewsItem, "id" | "title" | "source" | "publishedAt" | "sentiment" | "confidence" | "impact">): NewsItem {
  return {
    asset: "BTC",
    summary: "",
    ...overrides,
  };
}

export function testNewsService(assert: AssertFn) {
  const merged = dedupeNewsItems([
    makeNews({
      id: "a1",
      title: "Bitcoin breaks above key level",
      source: "CoinDesk",
      url: "https://example.com/a",
      publishedAt: 1000,
      sentiment: "positive",
      confidence: 70,
      impact: "medium",
    }),
    makeNews({
      id: "a2",
      title: "Bitcoin breaks above key level",
      source: "Cointelegraph",
      url: "https://example.com/b",
      publishedAt: 1100,
      sentiment: "positive",
      confidence: 72,
      impact: "medium",
    }),
    makeNews({
      id: "a3",
      title: "Ethereum sees renewed interest",
      source: "AMBCrypto",
      url: "https://example.com/c",
      publishedAt: 1200,
      sentiment: "positive",
      confidence: 68,
      impact: "low",
      asset: "ETH",
    }),
  ]);

  assert(merged.length === 2, "News dedupe removes duplicate headlines across sources");
  assert(merged[0].publishedAt >= merged[1].publishedAt, "News items are sorted by latest first");
}
