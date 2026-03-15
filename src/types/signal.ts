import { TimeframeScore } from "./scoring";
import { PivotRelation } from "./pivot";
import { TrendlineEngineOutput } from "./trendline";

export type SignalState =
  | "idle"
  | "watch_long"
  | "watch_short"
  | "ready_long"
  | "ready_short"
  | "triggered_long"
  | "triggered_short"
  | "active_long"
  | "active_short"
  | "invalidated";

export type TradingSignal = {
  symbol: string;

  state: SignalState;
  direction: "long" | "short" | "neutral";

  confidenceLong: number;
  confidenceShort: number;

  entryLong?: number;
  entryShort?: number;
  stopLoss?: number;
  takeProfit?: number;
  target?: number;

  riskRewardRatio?: number;
  invalidationReason?: string;

  summaryText: string;
  detailText: string[];

  updatedAt: number;
  cooldownUntil?: number;
};

export type SignalEngineInput = {
  symbol: string;

  timeframeScores: TimeframeScore[];
  globalLongPercent: number;
  globalShortPercent: number;

  pivotRelation: PivotRelation;
  trendlineOutput: TrendlineEngineOutput;

  structureState: string;
  currentPrice: number;
  atr?: number;

  nearestSupport?: number;
  nearestResistance?: number;
  latestSwingHigh?: number;
  latestSwingLow?: number;

  previousSignal?: TradingSignal;
  currentTime: number;
};
