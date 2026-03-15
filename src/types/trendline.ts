export type TrendlineType = "ascending_support" | "descending_resistance" | "horizontal_support" | "horizontal_resistance";

export type TrendlineInteraction =
  | "none"
  | "approaching"
  | "touch"
  | "bounce"
  | "break"
  | "retest";

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
};

export type TrendlineEngineOutput = {
  symbol: string;
  timeframe: string;
  activeTrendlines: Trendline[];
  nearbyTrendlines: Trendline[];
  trendlineCount: number;
  trendlineBias: "bullish" | "bearish" | "neutral";
  summary: string;
  updatedAt: number;
};
