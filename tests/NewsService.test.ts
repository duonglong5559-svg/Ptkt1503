import { AssertFn } from "./helpers";
import { analyzeSentiment, estimateImpact, mapAsset } from "../src/services/NewsService";

export function testNewsService(assert: AssertFn): void {
  const neutral = analyzeSentiment("Market update", "Sideways session with no major catalyst.");
  assert(neutral.sentiment === "neutral", "Neutral news stays neutral without keywords");
  assert(neutral.confidence === 35, "Neutral fallback confidence stays low");

  const positive = analyzeSentiment("Ethereum rally continues", "Strong adoption and breakout momentum");
  assert(positive.sentiment === "positive", "Positive keywords map to positive sentiment");
  assert(positive.confidence >= 50, "Positive sentiment confidence increases with keyword gap");

  const negative = analyzeSentiment("Bitcoin crash risk grows", "Analysts warn of another drop");
  assert(negative.sentiment === "negative", "Negative keywords map to negative sentiment");
  assert(negative.confidence >= 50, "Negative sentiment confidence increases with keyword gap");

  assert(mapAsset("Bitcoin ETF inflows") === "BTC", "Bitcoin news maps to BTC");
  assert(mapAsset("Ethereum upgrade ahead") === "ETH", "Ethereum news maps to ETH");
  assert(mapAsset("PAXG tracks gold demand") === "PAXG", "Gold proxy news maps to PAXG");
  assert(mapAsset("Macro market recap") === "general", "Unmapped article stays general");

  assert(estimateImpact("Fed warns of war risk for markets") === "high", "High-impact keywords map to high impact");
  assert(estimateImpact("Ethereum rally follows upgrade") === "medium", "Medium-impact keywords map to medium impact");
  assert(estimateImpact("Weekly market digest") === "low", "Generic headlines map to low impact");
}
