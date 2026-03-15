export type SwingType = "high" | "low";

export type SwingPoint = {
  type: SwingType;
  index: number;
  price: number;
  time: number;
  strength: number;
};

export type SwingEngineInput = {
  symbol: string;
  timeframe: string;
  candles: import("./candle").Candle[];
  lookback?: number;
};

export type SwingEngineOutput = {
  symbol: string;
  timeframe: string;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  allSwings: SwingPoint[];
  latestSwingHigh?: SwingPoint;
  latestSwingLow?: SwingPoint;
};
