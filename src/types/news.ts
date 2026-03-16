export type SentimentLabel = "positive" | "neutral" | "negative";
export type NewsImpact = "low" | "medium" | "high";

export type NewsItem = {
  id: string;
  asset: "BTC" | "ETH" | "PAXG" | "general";
  title: string;
  summary: string;
  source: string;
  publishedAt: number;
  sentiment: SentimentLabel;
  confidence: number;
  impact: NewsImpact;
};

export type NewsSentimentSummary = {
  asset: string;
  positive: number;
  neutral: number;
  negative: number;
  overallSentiment: SentimentLabel;
  overallConfidence: number;
};
