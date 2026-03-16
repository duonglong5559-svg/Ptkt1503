import {
  Candle,
  PatternEngineOutput,
  PivotRelation,
  TimeframeScore,
  AggregatedScore,
  TrendlineEngineOutput,
  TradingSignal,
  UIPayload,
  ReactionPlan,
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
    const reactionPlans = this.buildReactionPlans(currentPrice);

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
      reactionPlans,
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

  private buildReactionPlans(currentPrice: number): ReactionPlan[] {
    const plans: ReactionPlan[] = [];

    for (const [timeframe, result] of this.state.timeframeResults.entries()) {
      for (const line of result.trendlines.activeTrendlines) {
        plans.push(this.buildTrendlineReactionPlan(timeframe, result, line, currentPrice));
      }

      if (result.trendlines.activeTrendlines.length === 0) {
        const pivotSupport = result.pivotRelation.nearestSupport;
        const pivotResistance = result.pivotRelation.nearestResistance;
        if (pivotSupport !== undefined) {
          plans.push(this.buildPivotReactionPlan(timeframe, result, "support", pivotSupport, currentPrice));
        }
        if (pivotResistance !== undefined) {
          plans.push(this.buildPivotReactionPlan(timeframe, result, "resistance", pivotResistance, currentPrice));
        }
      }
    }

    return this.dedupeReactionPlans(plans).sort((a, b) => {
      const priorityDiff = this.getReactionStatusPriority(a.statusLabel) - this.getReactionStatusPriority(b.statusLabel);
      if (priorityDiff !== 0) return priorityDiff;
      const tfWeightA = this.getTimeframeWeight(a.timeframe);
      const tfWeightB = this.getTimeframeWeight(b.timeframe);
      if (tfWeightA !== tfWeightB) return tfWeightB - tfWeightA;
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      if (a.distanceAtr !== b.distanceAtr) return a.distanceAtr - b.distanceAtr;
      return b.strength - a.strength;
    }).slice(0, 10);
  }

  private buildTrendlineReactionPlan(
    timeframe: string,
    result: TimeframeAnalysisResult,
    line: TimeframeAnalysisResult["trendlines"]["activeTrendlines"][number],
    currentPrice: number
  ): ReactionPlan {
    const side: ReactionPlan["side"] = line.type.includes("support") ? "support" : "resistance";
    const atr = result.atr || currentPrice * 0.008;
    const { support, resistance, entryLong, entryShort } = this.signalEngine.estimateReactionLevels({
      currentPrice,
      atr: result.atr,
      pivotRelation: result.pivotRelation,
      trendlineOutput: result.trendlines,
      nearestSupport: result.pivotRelation.nearestSupport,
      nearestResistance: result.pivotRelation.nearestResistance,
    });
    const linePrice = line.projectedPriceNow;
    const entry = side === "support"
      ? (entryLong ?? support ?? linePrice)
      : (entryShort ?? resistance ?? linePrice);

    const targets = this.computeReactionTargets(side, entry, result, atr);
    const stopLoss = this.computeReactionStopLoss(side, linePrice, atr);
    const reward = Math.abs(targets.swingTarget - entry);
    const risk = Math.abs(entry - stopLoss) || 1;
    const riskReward = Math.round((reward / risk) * 10) / 10;
    const confidence = Math.min(99, Math.max(55, Math.round(line.strength * 0.92 + Math.max(0, line.touches - 2) * 3)));
    const status = this.describeReactionStatus(line.isBroken, line.proximity);
    const guidance = this.buildReactionGuidance(side, status, line.normalizedDistance);
    const autoAdjustPercent = Math.round((Math.abs(stopLoss - linePrice) / linePrice) * 1000) / 10;

    return {
      id: `${timeframe}-${line.id}`,
      timeframe,
      side,
      source: "trendline",
      price: linePrice,
      entry,
      scalpTarget: targets.scalpTarget,
      swingTarget: targets.swingTarget,
      stopLoss,
      riskReward,
      confidence,
      touches: line.touches,
      strength: line.strength,
      distanceAtr: Math.round(line.normalizedDistance * 10) / 10,
      statusLabel: status,
      guidance,
      autoAdjustPercent,
      isPrimary: line.tier === "primary",
      isBroken: line.isBroken,
    };
  }

  private buildPivotReactionPlan(
    timeframe: string,
    result: TimeframeAnalysisResult,
    side: ReactionPlan["side"],
    price: number,
    currentPrice: number
  ): ReactionPlan {
    const atr = result.atr || currentPrice * 0.008;
    const targets = this.computeReactionTargets(side, price, result, atr);
    const stopLoss = this.computeReactionStopLoss(side, price, atr);
    const reward = Math.abs(targets.swingTarget - price);
    const risk = Math.abs(price - stopLoss) || 1;
    const status = this.describeReactionStatus(false, Math.abs(currentPrice - price) / atr <= 0.25 ? "touch_zone" : Math.abs(currentPrice - price) / atr <= 0.6 ? "approaching" : "far");

    return {
      id: `${timeframe}-pivot-${side}-${price}`,
      timeframe,
      side,
      source: "pivot",
      price,
      entry: price,
      scalpTarget: targets.scalpTarget,
      swingTarget: targets.swingTarget,
      stopLoss,
      riskReward: Math.round((reward / risk) * 10) / 10,
      confidence: 62,
      touches: 1,
      strength: 55,
      distanceAtr: Math.round((Math.abs(currentPrice - price) / atr) * 10) / 10,
      statusLabel: status,
      guidance: this.buildReactionGuidance(side, status, Math.abs(currentPrice - price) / atr),
      autoAdjustPercent: Math.round((Math.abs(stopLoss - price) / price) * 1000) / 10,
      isPrimary: false,
      isBroken: false,
    };
  }

  private computeReactionTargets(
    side: ReactionPlan["side"],
    entry: number,
    result: TimeframeAnalysisResult,
    atr: number
  ): { scalpTarget: number; swingTarget: number } {
    const levels = result.pivotRelation.levels;
    const oppositeLines = result.trendlines.activeTrendlines
      .filter((line) =>
        !line.isBroken &&
        (side === "support" ? line.type.includes("resistance") : line.type.includes("support"))
      )
      .map((line) => line.projectedPriceNow);

    if (side === "support") {
      const scalpCandidates = [result.pivotRelation.targetHint, result.pivotRelation.nearestResistance, levels.pivot, entry + atr * 0.9, ...oppositeLines]
        .filter((value): value is number => value !== undefined && value > entry);
      const swingCandidates = [levels.r1, levels.r2, entry + atr * 1.8, ...oppositeLines]
        .filter((value): value is number => value !== undefined && value > entry);
      return {
        scalpTarget: this.roundPrice(Math.min(...scalpCandidates)),
        swingTarget: this.roundPrice(Math.max(...swingCandidates)),
      };
    }

    const scalpCandidates = [result.pivotRelation.targetHint, result.pivotRelation.nearestSupport, levels.pivot, entry - atr * 0.9, ...oppositeLines]
      .filter((value): value is number => value !== undefined && value < entry);
    const swingCandidates = [levels.s1, levels.s2, entry - atr * 1.8, ...oppositeLines]
      .filter((value): value is number => value !== undefined && value < entry);
    return {
      scalpTarget: this.roundPrice(Math.max(...scalpCandidates)),
      swingTarget: this.roundPrice(Math.min(...swingCandidates)),
    };
  }

  private computeReactionStopLoss(side: ReactionPlan["side"], price: number, atr: number): number {
    const buffer = Math.max(atr * 0.35, price * 0.002);
    return this.roundPrice(side === "support" ? price - buffer : price + buffer);
  }

  private describeReactionStatus(
    isBroken: boolean,
    proximity: "far" | "near" | "approaching" | "touch_zone" | "reaction_zone"
  ): string {
    if (isBroken) return "Đã mất hiệu lực";
    if (proximity === "reaction_zone" || proximity === "touch_zone") return "Đang phản ứng giá";
    if (proximity === "approaching" || proximity === "near") return "Chuẩn bị kế hoạch giao dịch";
    return "Chưa cần quan tâm";
  }

  private buildReactionGuidance(side: ReactionPlan["side"], statusLabel: string, distanceAtr: number): string {
    const typeLabel = side === "support" ? "hỗ trợ" : "kháng cự";
    if (statusLabel === "Đang phản ứng giá") return `Giá đang phản ứng tại ${typeLabel} (${distanceAtr.toFixed(1)} ATR).`;
    if (statusLabel === "Chuẩn bị kế hoạch giao dịch") return `Giá đang tiến gần ${typeLabel} (${distanceAtr.toFixed(1)} ATR).`;
    if (statusLabel === "Đã mất hiệu lực") return `${typeLabel[0].toUpperCase()}${typeLabel.slice(1)} đã bị xuyên thủng.`;
    return `Giá còn xa ${typeLabel} (${distanceAtr.toFixed(1)} ATR).`;
  }

  private dedupeReactionPlans(plans: ReactionPlan[]): ReactionPlan[] {
    const result: ReactionPlan[] = [];
    for (const plan of plans) {
      const isDuplicate = result.some((existing) =>
        existing.side === plan.side &&
        Math.abs(existing.price - plan.price) / plan.price < 0.003
      );
      if (!isDuplicate) result.push(plan);
    }
    return result;
  }

  private getReactionStatusPriority(statusLabel: string): number {
    if (statusLabel === "Đang phản ứng giá") return 0;
    if (statusLabel === "Chuẩn bị kế hoạch giao dịch") return 1;
    if (statusLabel === "Chưa cần quan tâm") return 2;
    return 3;
  }

  private getTimeframeWeight(timeframe: string): number {
    return ANALYSIS_TIMEFRAMES.indexOf(timeframe) + 1;
  }

  private roundPrice(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
