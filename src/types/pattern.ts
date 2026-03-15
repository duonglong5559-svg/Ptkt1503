export type PatternName =
  | "doji"
  | "hammer"
  | "inverted_hammer"
  | "shooting_star"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "morning_star"
  | "evening_star"
  | "three_white_soldiers"
  | "three_black_crows";

export type PatternSignal = {
  pattern: PatternName;
  direction: "bullish" | "bearish" | "neutral";
  strength: number;
  candleIndex: number;
  isConfirmed: boolean;
  contextBoost: number;
  notes: string[];
};

export type PatternEngineInput = {
  symbol: string;
  timeframe: string;
  candles: import("./candle").Candle[];
  currentTrendHint?: "bullish" | "bearish" | "neutral";
  atr?: number;
  nearestSupport?: number;
  nearestResistance?: number;
  nearestPivot?: number;
};

export type PatternEngineOutput = {
  symbol: string;
  timeframe: string;
  patterns: PatternSignal[];
  dominantPattern?: PatternSignal;
  updatedAt: number;
};
