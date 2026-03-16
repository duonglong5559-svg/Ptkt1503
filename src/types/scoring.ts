import { PatternSignal } from "./pattern";
import { PivotRelation } from "./pivot";
import { TrendlineEngineOutput } from "./trendline";

export type ScoreComponents = {
  pattern: number;
  pivot: number;
  trendline: number;
  structure: number;
  momentum: number;
  volatility: number;
  sr: number;
};

export type TimeframeScore = {
  symbol: string;
  timeframe: string;
  longScore: number;
  shortScore: number;
  dominantBias: "bullish" | "bearish" | "neutral";
  components: ScoreComponents;
  confidence: number;
  summary: string[];
  updatedAt: number;
};

export type ScoringEngineInput = {
  symbol: string;
  timeframe: string;

  patternSignals: PatternSignal[];
  pivotRelation: PivotRelation;
  trendlineOutput: TrendlineEngineOutput;

  structureState: string;
  srContext?: {
    nearestSupport?: number;
    nearestResistance?: number;
    supportDistance?: number;
    resistanceDistance?: number;
  };

  atr?: number;
  volatilityScore?: number;
  momentumScore?: number;
  currentPrice: number;
};

export type AggregatedScore = {
  symbol: string;
  globalLongPercent: number;
  globalShortPercent: number;
  dominantBias: "bullish" | "bearish" | "neutral";
  timeframeScores: TimeframeScore[];
  updatedAt: number;
};

export const TIMEFRAME_WEIGHTS: Record<string, number> = {
  "15m": 1,
  "1h": 2,
  "2h": 2,
  "4h": 3,
  "6h": 3,
  "8h": 3,
  "12h": 4,
  "1d": 5,
  "1w": 6,
};
