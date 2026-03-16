export type TrendlineType = "ascending_support" | "descending_resistance" | "horizontal_support" | "horizontal_resistance";

export type TrendlineInteraction =
  | "none"
  | "approaching"
  | "touch"
  | "bounce"
  | "break"
  | "retest";

export type TrendlineProximity = "far" | "near" | "approaching" | "touch_zone" | "reaction_zone";
export type TrendlineVisualState = "dim" | "near" | "hot" | "break" | "retest";
export type TrendlineTier = "primary" | "secondary";

export type Trendline = {
  id: string;
  type: TrendlineType;
  points: { x1: number; y1: number; x2: number; y2: number };
  slope: number;
  intercept: number;
  touches: number;
  strength: number;
  isBroken: boolean;
  lastInteraction: TrendlineInteraction;
  distanceToPrice: number;
  distanceToPricePercent: number;
  projectedPriceNow: number;
  normalizedDistance: number;
  proximity: TrendlineProximity;
  visualState: TrendlineVisualState;
  tier: TrendlineTier;
  validUntilIndex?: number;
  createdAt: number;
};

export type TrendlineEngineInput = {
  symbol: string;
  timeframe: string;
  candles: import("./candle").Candle[];
  swings: import("./swing").SwingPoint[];
  currentPrice: number;
  currentIndex: number;
  atr?: number;
};

export type TrendlineEngineOutput = {
  symbol: string;
  timeframe: string;
  activeTrendlines: Trendline[];
  nearbyTrendlines: Trendline[];
  trendlineCount: number;
  trendlineBias: "bullish" | "bearish" | "neutral";
  primarySupport?: Trendline;
  primaryResistance?: Trendline;
  summary: string;
  updatedAt: number;
};
