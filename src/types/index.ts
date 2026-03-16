export * from "./candle";
export * from "./pattern";
export * from "./pivot";
export * from "./swing";
export * from "./trendline";
export * from "./scoring";
export * from "./signal";
export * from "./symbol";
export * from "./feed";
export * from "./news";

export type StructureState =
  | "uptrend"
  | "downtrend"
  | "range"
  | "breakout"
  | "breakdown"
  | "retest_up"
  | "retest_down"
  | "BOS"
  | "CHOCH"
  | "transition";

import type { FeedHealth } from "./feed";
import type { NewsItem } from "./news";
import type { SignalState } from "./signal";

export type TimeframeBias = {
  long: number;
  short: number;
  state: "bullish" | "bearish" | "mixed";
  bias: "bullish" | "bearish" | "neutral";
  support?: number;
  resistance?: number;
  entryLong?: number;
  entryShort?: number;
};

export type ReactionPlan = {
  id: string;
  timeframe: string;
  side: "support" | "resistance";
  source: "trendline" | "pivot";
  price: number;
  entry: number;
  scalpTarget: number;
  swingTarget: number;
  stopLoss: number;
  riskReward: number;
  confidence: number;
  touches: number;
  strength: number;
  distanceAtr: number;
  statusLabel: string;
  guidance: string;
  autoAdjustPercent: number;
  isPrimary: boolean;
  isBroken: boolean;
};

export type UIPayload = {
  symbol: string;
  displaySymbol: string;
  currentPrice: number;

  feedHealth: FeedHealth;

  globalBias: {
    long: number;
    short: number;
    direction: "long" | "short" | "neutral";
  };

  timeframes: Record<string, TimeframeBias>;

  signal: {
    state: SignalState;
    direction: "long" | "short" | "neutral";
    confidenceLong: number;
    confidenceShort: number;
    entryLong?: number;
    entryShort?: number;
    stopLoss?: number;
    takeProfit?: number;
    target?: number;
    summary: string;
    details: string[];
    primaryScenario?: string;
    alternativeScenario?: string;
  };

  trendlineCount: number;
  pivotNarrative: string;
  reactionPlans: ReactionPlan[];

  news: NewsItem[];

  updatedAt: number;
};
