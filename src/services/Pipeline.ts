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
    const trendlineOutput = primaryResult?.trendlines || this.getDefaultTrendlineOutput();

    const swingData = this.getLatestSwingData();

    const signal = this.signalEngine.evaluate({
      symbol: this.state.symbol,
      timeframeScores,
      globalLongPercent: aggregated.globalLongPercent,
      globalShortPercent: aggregated.globalShortPercent,
      pivotRelation,
      trendlineOutput,
      structureState: primaryResult?.structure.state || "range",
      currentPrice,
      atr: primaryResult?.atr,
      nearestSupport: primaryResult?.pivotRelation.nearestSupport,
      nearestResistance: primaryResult?.pivotRelation.nearestResistance,
      latestSwingHigh: swingData.latestHigh,
      latestSwingLow: swingData.latestLow,
      previousSignal: this.state.lastSignal,
      currentTime: Date.now(),
    });

    this.state.lastSignal = signal;

    return this.buildUIPayload(currentPrice, aggregated, signal, pivotRelation);
  }

  runTickUpdate(currentPrice: number): UIPayload | null {
    if (!this.state.lastScores || !this.state.lastSignal || this.state.timeframeResults.size === 0) {
      return null;
    }

    // Re-run the analysis against the latest in-flight candles so the UI keeps
    // updating entries/trend proximity before the current candle is closed.
    return this.runFullAnalysis(currentPrice);
  }

  private recomputePivotForPrice(result: TimeframeAnalysisResult, currentPrice: number): PivotRelation {
    const levels = result.pivotRelation.levels;
    const distToPivot = currentPrice - levels.pivot;
    const distPercent = Math.abs(distToPivot) / levels.pivot * 100;

    let state = result.pivotRelation.state;
    if (distPercent < 0.15) state = "at_pivot";
    else if (distToPivot > 0) state = "above_pivot";
    else state = "below_pivot";

    const narrative = state === "above_pivot"
      ? `Giá đang ở phía trên Pivot daily ${levels.pivot.toFixed(2)}, kháng cự tiếp theo ${result.pivotRelation.nearestResistance?.toFixed(2) || "N/A"}.`
      : state === "below_pivot"
      ? `Giá đang ở phía dưới Pivot daily ${levels.pivot.toFixed(2)}, hỗ trợ tiếp theo ${result.pivotRelation.nearestSupport?.toFixed(2) || "N/A"}.`
      : `Giá đang quanh vùng Pivot daily ${levels.pivot.toFixed(2)}.`;

    return {
      ...result.pivotRelation,
      state,
      distanceToPivot: Math.round(distToPivot * 100) / 100,
      distanceToPivotPercent: Math.round(distPercent * 100) / 100,
      narrative,
    };
  }

  private analyzeTimeframe(
    tf: string,
    candles: Candle[],
    currentPrice: number
  ): TimeframeAnalysisResult {
    const closedCandles = candles.filter((c) => c.isClosed);
    const trendlineCandles = closedCandles.length > 0 ? closedCandles : candles;
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
    const pivotCandles = this.state.candleCache.get(pivotSourceTf) || candles;
    const pivotSourceCandle = this.getLastClosedCandle(pivotCandles);

    const pivotRelation = this.pivotEngine.analyze({
      symbol: this.state.symbol,
      sourceTimeframe: pivotSourceTf,
      high: pivotSourceCandle?.high || candles[candles.length - 1].high,
      low: pivotSourceCandle?.low || candles[candles.length - 1].low,
      close: pivotSourceCandle?.close || candles[candles.length - 1].close,
      currentPrice,
      momentum,
    });

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
      candles: trendlineCandles,
      swings: swings.allSwings,
      currentPrice,
      currentIndex: trendlineCandles.length - 1,
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
      nearestResistance: currentPrice,
      nearestSupport: currentPrice,
      targetHint: currentPrice,
      directionBias: "neutral",
      narrative: "Waiting for data.",
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
      let state: "bullish" | "bearish" | "mixed" = "mixed";
      if (s.dominantBias === "bullish") state = "bullish";
      else if (s.dominantBias === "bearish") state = "bearish";

      timeframes[s.timeframe] = {
        long: s.longScore,
        short: s.shortScore,
        state,
        bias: s.dominantBias,
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
}
