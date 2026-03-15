export * from "./candle";
export * from "./pattern";
export * from "./pivot";
export * from "./swing";
export * from "./trendline";
export * from "./scoring";
export * from "./signal";

export type UIPayload = {
  symbol: string;
  currentPrice: number;
  globalBias: {
    long: number;
    short: number;
    direction: "long" | "short" | "neutral";
  };
  timeframes: Record<
    string,
    {
      long: number;
      short: number;
      state: "bullish" | "bearish" | "mixed";
      bias: "bullish" | "bearish" | "neutral";
    }
  >;
  signal: {
    state: string;
    direction: string;
    entryLong?: number;
    entryShort?: number;
    stopLoss?: number;
    takeProfit?: number;
    target?: number;
    summary: string;
    details: string[];
  };
  trendlineCount: number;
  pivotNarrative: string;
  updatedAt: number;
};

export type StructureState =
  | "HH-HL"
  | "LH-LL"
  | "range"
  | "breakout"
  | "breakdown"
  | "retest_up"
  | "retest_down"
  | "transition";
