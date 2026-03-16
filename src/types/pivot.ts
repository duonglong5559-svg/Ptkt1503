export type PivotLevels = {
  pivot: number;
  r1: number;
  s1: number;
  r2: number;
  s2: number;
  r3: number;
  s3: number;
};

export type PivotState =
  | "above_pivot"
  | "below_pivot"
  | "at_pivot"
  | "approaching_pivot_from_below"
  | "approaching_pivot_from_above"
  | "rejected_from_pivot";

export type PivotRelation = {
  levels: PivotLevels;
  state: PivotState;
  distanceToPivot: number;
  distanceToPivotPercent: number;
  nearestResistance?: number;
  nearestSupport?: number;
  targetHint?: number;
  directionBias: "bullish" | "bearish" | "neutral";
  narrative: string;
};

export type PivotEngineInput = {
  symbol: string;
  sourceTimeframe: string;
  high: number;
  low: number;
  close: number;
  currentPrice: number;
  previousClose?: number;
  momentum?: "rising" | "falling" | "flat";
};
