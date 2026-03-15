import {
  Candle,
  CandleMetrics,
  computeCandleMetrics,
  PatternEngineInput,
  PatternEngineOutput,
  PatternSignal,
  PatternName,
} from "../types";

const DOJI_BODY_THRESHOLD = 0.1;
const HAMMER_LOWER_WICK_RATIO = 2.0;
const ENGULFING_MIN_BODY_RATIO = 0.3;
const THREE_SOLDIERS_MIN_BODY = 0.4;

export class PatternEngine {
  analyze(input: PatternEngineInput): PatternEngineOutput {
    const { candles, symbol, timeframe } = input;
    if (candles.length < 3) {
      return {
        symbol,
        timeframe,
        patterns: [],
        updatedAt: Date.now(),
      };
    }

    const closedCandles = candles.filter((c) => c.isClosed);
    if (closedCandles.length < 3) {
      return { symbol, timeframe, patterns: [], updatedAt: Date.now() };
    }

    const patterns: PatternSignal[] = [];
    const metrics = closedCandles.map(computeCandleMetrics);
    const lastIdx = closedCandles.length - 1;

    this.detectDoji(closedCandles, metrics, lastIdx, input, patterns);
    this.detectHammer(closedCandles, metrics, lastIdx, input, patterns);
    this.detectShootingStar(closedCandles, metrics, lastIdx, input, patterns);
    this.detectBullishEngulfing(closedCandles, metrics, lastIdx, input, patterns);
    this.detectBearishEngulfing(closedCandles, metrics, lastIdx, input, patterns);
    this.detectMorningStar(closedCandles, metrics, lastIdx, input, patterns);
    this.detectEveningStar(closedCandles, metrics, lastIdx, input, patterns);
    this.detectThreeWhiteSoldiers(closedCandles, metrics, lastIdx, input, patterns);
    this.detectThreeBlackCrows(closedCandles, metrics, lastIdx, input, patterns);

    patterns.forEach((p) => this.applyContextBoost(p, input));

    const sorted = patterns.sort((a, b) => b.strength - a.strength);
    return {
      symbol,
      timeframe,
      patterns: sorted,
      dominantPattern: sorted[0],
      updatedAt: Date.now(),
    };
  }

  private recentTrend(
    candles: Candle[],
    endIdx: number,
    lookback: number = 5
  ): "bullish" | "bearish" | "neutral" {
    const start = Math.max(0, endIdx - lookback);
    if (start >= endIdx) return "neutral";
    const priceChange = candles[endIdx].close - candles[start].close;
    const range = candles
      .slice(start, endIdx + 1)
      .reduce((max, c) => Math.max(max, c.high - c.low), 0);
    if (range === 0) return "neutral";
    const ratio = priceChange / range;
    if (ratio > 0.3) return "bullish";
    if (ratio < -0.3) return "bearish";
    return "neutral";
  }

  private detectDoji(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    const m = metrics[idx];
    if (m.bodyRatio > DOJI_BODY_THRESHOLD) return;
    if (m.range === 0) return;

    const trend = this.recentTrend(candles, idx);
    let direction: "bullish" | "bearish" | "neutral" = "neutral";
    let strength = 30;

    if (trend === "bullish") {
      direction = "bearish";
      strength = 40;
    } else if (trend === "bearish") {
      direction = "bullish";
      strength = 40;
    }

    out.push({
      pattern: "doji",
      direction,
      strength,
      candleIndex: idx,
      isConfirmed: candles[idx].isClosed,
      contextBoost: 0,
      notes: [
        `Body ratio: ${(m.bodyRatio * 100).toFixed(1)}%`,
        `Trend before: ${trend}`,
      ],
    });
  }

  private detectHammer(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    const m = metrics[idx];
    if (m.body === 0 && m.range === 0) return;
    if (m.bodyRatio > 0.35) return;
    if (m.lowerWick < HAMMER_LOWER_WICK_RATIO * m.body) return;
    if (m.upperWick > m.body) return;

    const c = candles[idx];
    const closeNearHigh =
      (c.close - c.low) / (m.range || 1) > 0.6;
    if (!closeNearHigh) return;

    const trend = this.recentTrend(candles, idx);
    let strength = 45;
    if (trend === "bearish") strength = 60;

    out.push({
      pattern: "hammer",
      direction: "bullish",
      strength,
      candleIndex: idx,
      isConfirmed: c.isClosed,
      contextBoost: 0,
      notes: [
        `Lower wick ${(m.lowerRatio * 100).toFixed(1)}% of range`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectShootingStar(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    const m = metrics[idx];
    if (m.body === 0 && m.range === 0) return;
    if (m.bodyRatio > 0.35) return;
    if (m.upperWick < HAMMER_LOWER_WICK_RATIO * m.body) return;
    if (m.lowerWick > m.body) return;

    const c = candles[idx];
    const closeNearLow =
      (c.high - c.close) / (m.range || 1) > 0.6;
    if (!closeNearLow) return;

    const trend = this.recentTrend(candles, idx);
    let strength = 45;
    if (trend === "bullish") strength = 60;

    out.push({
      pattern: "shooting_star",
      direction: "bearish",
      strength,
      candleIndex: idx,
      isConfirmed: c.isClosed,
      contextBoost: 0,
      notes: [
        `Upper wick ${(m.upperRatio * 100).toFixed(1)}% of range`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectBullishEngulfing(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 1) return;
    const prev = metrics[idx - 1];
    const curr = metrics[idx];
    const pCandle = candles[idx - 1];
    const cCandle = candles[idx];

    if (!prev.isBear) return;
    if (!curr.isBull) return;
    if (curr.bodyRatio < ENGULFING_MIN_BODY_RATIO) return;
    if (cCandle.open > pCandle.close) return;
    if (cCandle.close < pCandle.open) return;

    const trend = this.recentTrend(candles, idx);
    let strength = 55;
    if (trend === "bearish") strength = 68;
    if (curr.body > prev.body * 1.5) strength += 5;

    out.push({
      pattern: "bullish_engulfing",
      direction: "bullish",
      strength,
      candleIndex: idx,
      isConfirmed: cCandle.isClosed,
      contextBoost: 0,
      notes: [
        `Engulfing body ratio: ${(curr.body / (prev.body || 1)).toFixed(2)}x`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectBearishEngulfing(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 1) return;
    const prev = metrics[idx - 1];
    const curr = metrics[idx];
    const pCandle = candles[idx - 1];
    const cCandle = candles[idx];

    if (!prev.isBull) return;
    if (!curr.isBear) return;
    if (curr.bodyRatio < ENGULFING_MIN_BODY_RATIO) return;
    if (cCandle.open < pCandle.close) return;
    if (cCandle.close > pCandle.open) return;

    const trend = this.recentTrend(candles, idx);
    let strength = 55;
    if (trend === "bullish") strength = 68;
    if (curr.body > prev.body * 1.5) strength += 5;

    out.push({
      pattern: "bearish_engulfing",
      direction: "bearish",
      strength,
      candleIndex: idx,
      isConfirmed: cCandle.isClosed,
      contextBoost: 0,
      notes: [
        `Engulfing body ratio: ${(curr.body / (prev.body || 1)).toFixed(2)}x`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectMorningStar(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 2) return;
    const first = metrics[idx - 2];
    const mid = metrics[idx - 1];
    const last = metrics[idx];
    const c0 = candles[idx - 2];
    const c1 = candles[idx - 1];
    const c2 = candles[idx];

    if (!first.isBear) return;
    if (first.bodyRatio < 0.4) return;
    if (mid.bodyRatio > 0.3) return;
    if (!last.isBull) return;
    if (last.bodyRatio < 0.4) return;

    if (c2.close < (c0.open + c0.close) / 2) return;

    const trend = this.recentTrend(candles, idx - 2);
    let strength = 65;
    if (trend === "bearish") strength = 78;

    out.push({
      pattern: "morning_star",
      direction: "bullish",
      strength,
      candleIndex: idx,
      isConfirmed: c2.isClosed,
      contextBoost: 0,
      notes: [
        `3-candle reversal pattern`,
        `Mid candle body: ${(mid.bodyRatio * 100).toFixed(1)}%`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectEveningStar(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 2) return;
    const first = metrics[idx - 2];
    const mid = metrics[idx - 1];
    const last = metrics[idx];
    const c0 = candles[idx - 2];
    const c1 = candles[idx - 1];
    const c2 = candles[idx];

    if (!first.isBull) return;
    if (first.bodyRatio < 0.4) return;
    if (mid.bodyRatio > 0.3) return;
    if (!last.isBear) return;
    if (last.bodyRatio < 0.4) return;

    if (c2.close > (c0.open + c0.close) / 2) return;

    const trend = this.recentTrend(candles, idx - 2);
    let strength = 65;
    if (trend === "bullish") strength = 78;

    out.push({
      pattern: "evening_star",
      direction: "bearish",
      strength,
      candleIndex: idx,
      isConfirmed: c2.isClosed,
      contextBoost: 0,
      notes: [
        `3-candle reversal pattern`,
        `Mid candle body: ${(mid.bodyRatio * 100).toFixed(1)}%`,
        `Prior trend: ${trend}`,
      ],
    });
  }

  private detectThreeWhiteSoldiers(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 2) return;
    const m = [metrics[idx - 2], metrics[idx - 1], metrics[idx]];
    const c = [candles[idx - 2], candles[idx - 1], candles[idx]];

    for (let i = 0; i < 3; i++) {
      if (!m[i].isBull) return;
      if (m[i].bodyRatio < THREE_SOLDIERS_MIN_BODY) return;
    }

    if (c[1].close <= c[0].close) return;
    if (c[2].close <= c[1].close) return;
    if (c[1].open < c[0].open || c[1].open > c[0].close) return;
    if (c[2].open < c[1].open || c[2].open > c[1].close) return;

    const trend = this.recentTrend(candles, idx - 2);
    let strength = 70;
    if (trend === "bearish") strength = 82;

    out.push({
      pattern: "three_white_soldiers",
      direction: "bullish",
      strength,
      candleIndex: idx,
      isConfirmed: c[2].isClosed,
      contextBoost: 0,
      notes: [`3 consecutive strong bullish candles`, `Prior trend: ${trend}`],
    });
  }

  private detectThreeBlackCrows(
    candles: Candle[],
    metrics: CandleMetrics[],
    idx: number,
    input: PatternEngineInput,
    out: PatternSignal[]
  ): void {
    if (idx < 2) return;
    const m = [metrics[idx - 2], metrics[idx - 1], metrics[idx]];
    const c = [candles[idx - 2], candles[idx - 1], candles[idx]];

    for (let i = 0; i < 3; i++) {
      if (!m[i].isBear) return;
      if (m[i].bodyRatio < THREE_SOLDIERS_MIN_BODY) return;
    }

    if (c[1].close >= c[0].close) return;
    if (c[2].close >= c[1].close) return;
    if (c[1].open > c[0].open || c[1].open < c[0].close) return;
    if (c[2].open > c[1].open || c[2].open < c[1].close) return;

    const trend = this.recentTrend(candles, idx - 2);
    let strength = 70;
    if (trend === "bullish") strength = 82;

    out.push({
      pattern: "three_black_crows",
      direction: "bearish",
      strength,
      candleIndex: idx,
      isConfirmed: c[2].isClosed,
      contextBoost: 0,
      notes: [`3 consecutive strong bearish candles`, `Prior trend: ${trend}`],
    });
  }

  private applyContextBoost(
    signal: PatternSignal,
    input: PatternEngineInput
  ): void {
    let boost = 0;
    const notes: string[] = [];

    if (input.currentTrendHint) {
      if (
        signal.direction === "bullish" &&
        input.currentTrendHint === "bearish"
      ) {
        boost += 8;
        notes.push("Counter-trend reversal pattern (context boost)");
      } else if (
        signal.direction === "bearish" &&
        input.currentTrendHint === "bullish"
      ) {
        boost += 8;
        notes.push("Counter-trend reversal pattern (context boost)");
      } else if (signal.direction === input.currentTrendHint) {
        boost += 3;
        notes.push("Pattern aligns with current trend");
      }
    }

    if (input.nearestSupport !== undefined && input.atr) {
      const distToSupport = Math.abs(
        input.candles[input.candles.length - 1]?.close - input.nearestSupport
      );
      if (distToSupport < input.atr * 0.5 && signal.direction === "bullish") {
        boost += 10;
        notes.push("Near support zone (strong context)");
      }
    }

    if (input.nearestResistance !== undefined && input.atr) {
      const lastClose = input.candles[input.candles.length - 1]?.close;
      const distToResist = Math.abs(lastClose - input.nearestResistance);
      if (distToResist < input.atr * 0.5 && signal.direction === "bearish") {
        boost += 10;
        notes.push("Near resistance zone (strong context)");
      }
    }

    if (input.nearestPivot !== undefined && input.atr) {
      const lastClose = input.candles[input.candles.length - 1]?.close;
      const distToPivot = Math.abs(lastClose - input.nearestPivot);
      if (distToPivot < input.atr * 0.8) {
        boost += 5;
        notes.push("Near pivot level");
      }
    }

    signal.contextBoost = boost;
    signal.strength = Math.min(100, signal.strength + boost);
    signal.notes.push(...notes);
  }
}
