import { NewsItem, SentimentLabel, NewsSentimentSummary } from "../types/news";

export class SentimentEngine {
  summarize(news: NewsItem[], targetAsset?: string): NewsSentimentSummary {
    const relevant = targetAsset
      ? news.filter((n) => n.asset === targetAsset || n.asset === "general")
      : news;

    let positive = 0;
    let neutral = 0;
    let negative = 0;
    let totalConfidence = 0;

    for (const item of relevant) {
      if (item.sentiment === "positive") positive++;
      else if (item.sentiment === "negative") negative++;
      else neutral++;
      totalConfidence += item.confidence;
    }

    const total = relevant.length || 1;
    const avgConfidence = Math.round(totalConfidence / total);

    let overallSentiment: SentimentLabel = "neutral";
    if (positive > negative && positive > neutral) overallSentiment = "positive";
    else if (negative > positive && negative > neutral) overallSentiment = "negative";

    return {
      asset: targetAsset || "all",
      positive,
      neutral,
      negative,
      overallSentiment,
      overallConfidence: avgConfidence,
    };
  }
}
