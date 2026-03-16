import {
  Candle,
  PatternEngineOutput,
  PivotRelation,
  TimeframeScore,
  AggregatedScore,
  TrendlineEngineOutput,
  TradingSignal,
  UIPayload,
  StructureState,
  FeedHealth,
  NewsItem,
  createInitialFeedHealth,
} from "../types";
import {
  PatternEngine,
  PivotEngine,
  SwingEngine,
  TrendlineEngine,
  StructureEngine,
  ScoringEngine,
  SignalEngine,
} from "../engines";
import {
  computeATR,
  computeVolatilityScore,
  computeMomentumScore,
  detectMomentumDirection,
  computeSRLevels,
} from "../utils";
import { StructureEngineOutput } from "../engines/StructureEngine";
import { SymbolMapping } from "./SymbolMapping";

export type PipelineState = {
  symbol: string;
  candleCache: Map<string, Candle[]>;
  lastSignal?: TradingSignal;
  lastScores?: AggregatedScore;
  timeframeResults: Map<string, TimeframeAnalysisResult>;
  feedHealth: FeedHealth;
  news: NewsItem[];
};

export type TimeframeAnalysisResult = {
  patterns: PatternEngineOutput;
  pivotRelation: PivotRelation;
  trendlines: TrendlineEngineOutput;
  structure: StructureEngineOutput;
  score: TimeframeScore;
  atr: number;
};

const ANALYSIS_TIMEFRAMES = [
  "15m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "1w",
];

const PIVOT_SOURCE_TF: Record<string, string> = {
  "15m": "1d",
  "1h": "1d",
  "2h": "1d",
  "4h": "1d",
  "6h": "1w",
  "8h": "1w",
  "12h": "1w",
  "1d": "1w",
  "1w": "1w",
};

export class Pipeline {
  private patternEngine = new PatternEngine();
  private pivotEngine = new PivotEngine();
  private swingEngine = new SwingEngine();
  private trendlineEngine = new TrendlineEngine();
  private structureEngine = new StructureEngine();
  private scoringEngine = new ScoringEngine();
  private signalEngine = new SignalEngine();

  private state: PipelineState;

  constructor(symbol: string) {
    this.state = {
      symbol,
      candleCache: new Map(),
      timeframeResults: new Map(),
      feedHealth: createInitialFeedHealth(),
      news: [],
    };
  }

  setFeedHealth(health: FeedHealth): void {
    this.state.feedHealth = health;
  }

  setNews(news: NewsItem[]): void {
    this.state.news = news;
  }

  getState(): PipelineState {
    return this.state;
  }

  initializeCache(timeframe: string, candles: Candle[]): void {
    this.state.candleCache.set(timeframe, [...candles]);
  }

  updateCandle(timeframe: string, candle: Candle): void {
    const cache = this.state.candleCache.get(timeframe);
    if (!cache) {
      this.state.candleCache.set(timeframe, [candle]);
      return;
    }

    const lastIdx = cache.length - 1;
    if (lastIdx >= 0 && cache[lastIdx].openTime === candle.openTime) {
      cache[lastIdx] = candle;
    } else {
      cache.push(candle);
      if (cache.length > 500) {
        cache.splice(0, cache.length - 500);
      }
    }
  }

  runFullAnalysis(currentPrice: number): UIPayload {
    const timeframeScores: TimeframeScore[] = [];

    for (const tf of ANALYSIS_TIMEFRAMES) {
      const candles = this.state.candleCache.get(tf);
      if (!candles || candles.length < 10) continue;

      const result = this.analyzeTimeframe(tf, candles, currentPrice);
      this.state.timeframeResults.set(tf, result);
      timeframeScores.push(result.score);
    }

    const aggregated = this.scoringEngine.aggregate(timeframeScores);
    this.state.lastScores = aggregated;

    const primaryTf = this.getPrimaryTimeframe();
    const primaryResult = this.state.timeframeResults.get(primaryTf);

    const pivotRelation = primaryResult?.pivotRelation || this.getDefaultPivotRelation(currentPrice);

    const swingData = this.getLatestSwingData();

    const signal = this.buildSignalForCurrentContext(
      currentPrice,
      aggregated,
      primaryResult,
      pivotRelation,
      swingData,
      timeframeScores
    );

    this.state.lastSignal = signal;

    return this.buildUIPayload(currentPrice, aggregated, signal, pivotRelation);
  }

  runTickUpdate(currentPrice: number): UIPayload | null {
    if (!this.state.lastScores || !this.state.lastSignal) return null;

    const primaryTf = this.getPrimaryTimeframe();
    const primaryResult = this.state.timeframeResults.get(primaryTf);
    if (!primaryResult) return null;

    const pivotRelation = this.recomputePivotForPrice(primaryResult, currentPrice);
    const swingData = this.getLatestSwingData();
    const signal = this.buildSignalForCurrentContext(
      currentPrice,
      this.state.lastScores,
      primaryResult,
      pivotRelation,
      swingData,
      this.state.lastScores.timeframeScores
    );
    this.state.lastSignal = signal;

    return this.buildUIPayload(
      currentPrice,
      this.state.lastScores,
      signal,
      pivotRelation
    );
  }

  private recomputePivotForPrice(result: TimeframeAnalysisResult, currentPrice: number): PivotRelation {
    const levels = result.pivotRelation.levels;
    const distToPivot = currentPrice - levels.pivot;
    const distPercent = Math.abs(distToPivot) / levels.pivot * 100;
    const nearestResistance = this.findNearestPivotAbove(currentPrice, levels);
    const nearestSupport = this.findNearestPivotBelow(currentPrice, levels);

    let state = result.pivotRelation.state;
    if (distPercent < 0.15) state = "at_pivot";
    else if (distToPivot > 0) state = "above_pivot";
    else state = "below_pivot";

    const narrative = state === "above_pivot"
      ? `Giá đang ở phía trên Pivot daily ${levels.pivot.toFixed(2)}, kháng cự tiếp theo ${nearestResistance?.toFixed(2) || "N/A"}.`
      : state === "below_pivot"
      ? `Giá đang ở phía dưới Pivot daily ${levels.pivot.toFixed(2)}, hỗ trợ tiếp theo ${nearestSupport?.toFixed(2) || "N/A"}.`
      : `Giá đang quanh vùng Pivot daily ${levels.pivot.toFixed(2)}.`;

    return {
      ...result.pivotRelation,
      state,
      distanceToPivot: Math.round(distToPivot * 100) / 100,
      distanceToPivotPercent: Math.round(distPercent * 100) / 100,
      nearestResistance,
      nearestSupport,
      targetHint: state === "above_pivot" ? nearestSupport : state === "below_pivot" ? nearestResistance : levels.pivot,
      narrative,
    };
  }

  private analyzeTimeframe(
    tf: string,
    candles: Candle[],
    currentPrice: number
  ): TimeframeAnalysisResult {
    const atr = computeATR(candles);
    const volScore = computeVolatilityScore(atr, currentPrice);
    const momScore = computeMomentumScore(candles);
    const momentum = detectMomentumDirection(candles);

    const swings = this.swingEngine.analyze({
      symbol: this.state.symbol,
      timeframe: tf,
      candles,
    });

    const structure = this.structureEngine.analyze({
      symbol: this.state.symbol,
      timeframe: tf,
      swingHighs: swings.swingHighs,
      swingLows: swings.swingLows,
      currentPrice,
    });

    const srContext = computeSRLevels(
      swings.swingHighs,
      swings.swingLows,
      currentPrice
    );

    const pivotSourceTf = PIVOT_SOURCE_TF[tf] || "1d";
    const pivotCandles = this.state.candleCache.get(pivotSourceTf);
    const pivotSourceCandle = pivotCandles ? this.getLastClosedCandle(pivotCandles) : null;

    const pivotRelation = pivotSourceCandle
      ? this.pivotEngine.analyze({
          symbol: this.state.symbol,
          sourceTimeframe: pivotSourceTf,
          high: pivotSourceCandle.high,
          low: pivotSourceCandle.low,
          close: pivotSourceCandle.close,
          currentPrice,
          momentum,
        })
      : this.getMissingPivotRelation(currentPrice, pivotSourceTf);

    const currentTrendHint =
      structure.isUptrend ? "bullish" :
      structure.isDowntrend ? "bearish" : "neutral";

    const patterns = this.patternEngine.analyze({
      symbol: this.state.symbol,
      timeframe: tf,
      candles,
      currentTrendHint,
      atr,
      nearestSupport: srContext.nearestSupport,
      nearestResistance: srContext.nearestResistance,
      nearestPivot: pivotRelation.levels.pivot,
    });

    const currentIndex = candles.length - 1;
    const trendlines = this.trendlineEngine.analyze({
      symbol: this.state.symbol,
      timeframe: tf,
      candles,
      swings: swings.allSwings,
      currentPrice,
      currentIndex,
      atr,
    });

    const score = this.scoringEngine.scoreTimeframe({
      symbol: this.state.symbol,
      timeframe: tf,
      patternSignals: patterns.patterns,
      pivotRelation,
      trendlineOutput: trendlines,
      structureState: structure.state,
      srContext: {
        nearestSupport: srContext.nearestSupport,
        nearestResistance: srContext.nearestResistance,
        supportDistance: srContext.supportDistance,
        resistanceDistance: srContext.resistanceDistance,
      },
      atr,
      volatilityScore: volScore,
      momentumScore: momScore,
      currentPrice,
    });

    return {
      patterns,
      pivotRelation,
      trendlines,
      structure,
      score,
      atr,
    };
  }

  private getLastClosedCandle(candles: Candle[]): Candle | null {
    for (let i = candles.length - 1; i >= 0; i--) {
      if (candles[i].isClosed) return candles[i];
    }
    return null;
  }

  private getPrimaryTimeframe(): string {
    const preferred = ["1h", "4h", "15m"];
    for (const tf of preferred) {
      if (this.state.timeframeResults.has(tf)) return tf;
    }
    const keys = Array.from(this.state.timeframeResults.keys());
    return keys[0] || "1h";
  }

  private getLatestSwingData(): { latestHigh?: number; latestLow?: number } {
    const primaryTf = this.getPrimaryTimeframe();
    const candles = this.state.candleCache.get(primaryTf);
    if (!candles) return {};

    const swings = this.swingEngine.analyze({
      symbol: this.state.symbol,
      timeframe: primaryTf,
      candles,
    });

    return {
      latestHigh: swings.latestSwingHigh?.price,
      latestLow: swings.latestSwingLow?.price,
    };
  }

  private getDefaultPivotRelation(currentPrice: number): PivotRelation {
    return {
      levels: { pivot: currentPrice, r1: currentPrice, s1: currentPrice, r2: currentPrice, s2: currentPrice, r3: currentPrice, s3: currentPrice },
      state: "at_pivot",
      distanceToPivot: 0,
      distanceToPivotPercent: 0,
      nearestResistance: undefined,
      nearestSupport: undefined,
      targetHint: undefined,
      directionBias: "neutral",
      narrative: "Waiting for data.",
    };
  }

  private getMissingPivotRelation(currentPrice: number, sourceTimeframe: string): PivotRelation {
    return {
      levels: {
        pivot: currentPrice,
        r1: currentPrice,
        s1: currentPrice,
        r2: currentPrice,
        s2: currentPrice,
        r3: currentPrice,
        s3: currentPrice,
      },
      state: "at_pivot",
      distanceToPivot: 0,
      distanceToPivotPercent: 0,
      nearestResistance: undefined,
      nearestSupport: undefined,
      targetHint: undefined,
      directionBias: "neutral",
      narrative: `Thiếu dữ liệu Pivot khung ${sourceTimeframe}. Tạm bỏ qua bộ lọc pivot.`,
    };
  }

  private getDefaultTrendlineOutput(): TrendlineEngineOutput {
    return {
      symbol: this.state.symbol,
      timeframe: "",
      activeTrendlines: [],
      nearbyTrendlines: [],
      trendlineCount: 0,
      trendlineBias: "neutral",
      summary: "No trendline data.",
      updatedAt: Date.now(),
    };
  }

  private dedupeTrendlineCount(lines: { type: string; points: { y1: number; y2: number } }[]): number {
    if (lines.length === 0) return 0;
    const unique: typeof lines = [];
    for (const line of lines) {
      const isDup = unique.some((u) =>
        u.type === line.type &&
        Math.abs(u.points.y1 - line.points.y1) / (u.points.y1 || 1) < 0.005 &&
        Math.abs(u.points.y2 - line.points.y2) / (u.points.y2 || 1) < 0.005
      );
      if (!isDup) unique.push(line);
    }
    return unique.length;
  }

  private buildUIPayload(
    currentPrice: number,
    aggregated: AggregatedScore,
    signal: TradingSignal,
    pivotRelation: PivotRelation
  ): UIPayload {
    const timeframes: UIPayload["timeframes"] = {};

    for (const s of aggregated.timeframeScores) {
      const timeframeResult = this.state.timeframeResults.get(s.timeframe);
      let state: "bullish" | "bearish" | "mixed" = "mixed";
      if (s.dominantBias === "bullish") state = "bullish";
      else if (s.dominantBias === "bearish") state = "bearish";

      const reaction = timeframeResult
        ? this.signalEngine.estimateReactionLevels({
            currentPrice,
            atr: timeframeResult.atr,
            pivotRelation: timeframeResult.pivotRelation,
            trendlineOutput: timeframeResult.trendlines,
            nearestSupport: timeframeResult.pivotRelation.nearestSupport,
            nearestResistance: timeframeResult.pivotRelation.nearestResistance,
          })
        : {};

      timeframes[s.timeframe] = {
        long: s.longScore,
        short: s.shortScore,
        state,
        bias: s.dominantBias,
        support: reaction.support,
        resistance: reaction.resistance,
        entryLong: reaction.entryLong,
        entryShort: reaction.entryShort,
      };
    }

    const allTrendlines = Array.from(this.state.timeframeResults.values())
      .flatMap((r) => r.trendlines.activeTrendlines);
    const trendlineCount = Math.min(5, this.dedupeTrendlineCount(allTrendlines));

    return {
      symbol: this.state.symbol,
      displaySymbol: SymbolMapping.getDisplayLabel(this.state.symbol),
      currentPrice,
      feedHealth: this.state.feedHealth,
      globalBias: {
        long: aggregated.globalLongPercent,
        short: aggregated.globalShortPercent,
        direction: aggregated.dominantBias === "bullish" ? "long" :
                   aggregated.dominantBias === "bearish" ? "short" : "neutral",
      },
      timeframes,
      signal: {
        state: signal.state,
        direction: signal.direction,
        confidenceLong: signal.confidenceLong,
        confidenceShort: signal.confidenceShort,
        entryLong: signal.entryLong,
        entryShort: signal.entryShort,
        stopLoss: signal.stopLoss,
        takeProfit: signal.takeProfit,
        target: signal.target,
        summary: signal.summaryText,
        details: signal.detailText,
        primaryScenario: signal.primaryScenario,
        alternativeScenario: signal.alternativeScenario,
      },
      trendlineCount,
      pivotNarrative: pivotRelation.narrative,
      news: this.state.news,
      updatedAt: Date.now(),
    };
  }

  private buildSignalForCurrentContext(
    currentPrice: number,
    aggregated: AggregatedScore,
    primaryResult: TimeframeAnalysisResult | undefined,
    pivotRelation: PivotRelation,
    swingData: { latestHigh?: number; latestLow?: number },
    timeframeScores: TimeframeScore[]
  ): TradingSignal {
    return this.signalEngine.evaluate({
      symbol: this.state.symbol,
      timeframeScores,
      globalLongPercent: aggregated.globalLongPercent,
      globalShortPercent: aggregated.globalShortPercent,
      pivotRelation,
      trendlineOutput: primaryResult?.trendlines || this.getDefaultTrendlineOutput(),
      structureState: primaryResult?.structure.state || "range",
      currentPrice,
      atr: primaryResult?.atr,
      nearestSupport: pivotRelation.nearestSupport,
      nearestResistance: pivotRelation.nearestResistance,
      latestSwingHigh: swingData.latestHigh,
      latestSwingLow: swingData.latestLow,
      previousSignal: this.state.lastSignal,
      currentTime: Date.now(),
    });
  }

  private findNearestPivotAbove(price: number, levels: PivotRelation["levels"]): number | undefined {
    return [levels.s3, levels.s2, levels.s1, levels.pivot, levels.r1, levels.r2, levels.r3]
      .sort((a, b) => a - b)
      .find((level) => level > price);
  }

  private findNearestPivotBelow(price: number, levels: PivotRelation["levels"]): number | undefined {
    return [levels.s3, levels.s2, levels.s1, levels.pivot, levels.r1, levels.r2, levels.r3]
      .sort((a, b) => b - a)
      .find((level) => level < price);
  }
}
