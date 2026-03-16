import { SignalEngine } from "../src/engines/SignalEngine";
import { AssertFn } from "./helpers";
import { PivotRelation, TrendlineEngineOutput, TimeframeScore } from "../src/types";

function makePivot(overrides: Partial<PivotRelation> = {}): PivotRelation {
  return {
    levels: { pivot: 100, r1: 108, s1: 94, r2: 114, s2: 90, r3: 120, s3: 84 },
    state: "above_pivot",
    distanceToPivot: 4,
    distanceToPivotPercent: 4,
    nearestResistance: 108,
    nearestSupport: 94,
    targetHint: 108,
    directionBias: "bullish",
    narrative: "Test pivot narrative",
    ...overrides,
  };
}

function makeTL(overrides: Partial<TrendlineEngineOutput> = {}): TrendlineEngineOutput {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    activeTrendlines: [],
    nearbyTrendlines: [],
    trendlineCount: 0,
    trendlineBias: "neutral",
    summary: "",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeScores(values: Array<[string, number, number, "bullish" | "bearish" | "neutral"]>): TimeframeScore[] {
  return values.map(([timeframe, longScore, shortScore, dominantBias]) => ({
    symbol: "BTCUSDT",
    timeframe,
    longScore,
    shortScore,
    dominantBias,
    components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 },
    confidence: 65,
    summary: [],
    updatedAt: Date.now(),
  }));
}

export function testScenarioEngine(assert: AssertFn) {
  const engine = new SignalEngine();

  // Fake breakout trap: strong local long, but macro bearish and no candle confirmation
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores([
        ["15m", 72, 28, "bullish"],
        ["1h", 70, 30, "bullish"],
        ["4h", 38, 62, "bearish"],
        ["1d", 30, 70, "bearish"],
      ]),
      globalLongPercent: 66,
      globalShortPercent: 34,
      pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTL(),
      structureState: "breakout",
      emaContext: {
        ema20: 103,
        ema50: 99,
        ema200: 95,
        priceAboveEma20: true,
        priceAboveEma50: true,
        bullishAligned: true,
        bearishAligned: false,
        ema20Slope: 0.5,
        ema50Slope: 0.3,
        ema200Slope: 0.1,
      },
      volumeContext: {
        currentVolume: 1300,
        averageVolume: 1100,
        relativeVolume: 1.18,
        bullVolumeRatio: 0.57,
        bearVolumeRatio: 0.43,
        trend: "expanding",
        breakoutConfirmed: false,
      },
      candleConfirmation: {
        bullishBreakoutConfirmed: false,
        bearishBreakdownConfirmed: false,
        bullishRetestConfirmed: false,
        bearishRetestConfirmed: false,
        lastCandleDirection: "bullish",
        bodyStrength: 52,
        closeLocation: 0.71,
        summary: "Breakout trap chưa được xác nhận.",
      },
      currentPrice: 104,
      atr: 4,
      nearestSupport: 100,
      nearestResistance: 108,
      latestSwingLow: 99,
      currentTime: Date.now(),
    });

    assert(result.state === "idle" || result.state === "watch_long", `Fake breakout trap stays conservative (got ${result.state})`);
    assert((result.tradeQualityScore || 0) < 60, "Fake breakout trap has low trade quality");
  }

  // Trend continuation: aligned frames + retest candle should promote long
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores([
        ["15m", 63, 37, "bullish"],
        ["1h", 68, 32, "bullish"],
        ["4h", 72, 28, "bullish"],
        ["1d", 70, 30, "bullish"],
      ]),
      globalLongPercent: 69,
      globalShortPercent: 31,
      pivotRelation: makePivot({ nearestSupport: 101, nearestResistance: 110, targetHint: 110 }),
      trendlineOutput: makeTL(),
      structureState: "retest_up",
      emaContext: {
        ema20: 103,
        ema50: 100,
        ema200: 95,
        priceAboveEma20: true,
        priceAboveEma50: true,
        bullishAligned: true,
        bearishAligned: false,
        ema20Slope: 0.4,
        ema50Slope: 0.25,
        ema200Slope: 0.1,
      },
      volumeContext: {
        currentVolume: 1650,
        averageVolume: 1000,
        relativeVolume: 1.65,
        bullVolumeRatio: 0.63,
        bearVolumeRatio: 0.37,
        trend: "expanding",
        breakoutConfirmed: true,
      },
      candleConfirmation: {
        bullishBreakoutConfirmed: false,
        bearishBreakdownConfirmed: false,
        bullishRetestConfirmed: true,
        bearishRetestConfirmed: false,
        lastCandleDirection: "bullish",
        bodyStrength: 61,
        closeLocation: 0.79,
        summary: "Retest Long giữ hỗ trợ.",
      },
      currentPrice: 104,
      atr: 3.5,
      nearestSupport: 101,
      nearestResistance: 110,
      latestSwingLow: 100.5,
      currentTime: Date.now(),
    });

    assert(result.state === "ready_long" || result.state === "watch_long", `Trend continuation long remains valid (got ${result.state})`);
    assert((result.tradeQualityScore || 0) >= 58, "Trend continuation has healthy trade quality");
  }

  // CHOCH reversal: macro flips and breakout confirmation supports reversal
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores([
        ["15m", 73, 27, "bullish"],
        ["1h", 71, 29, "bullish"],
        ["4h", 66, 34, "bullish"],
        ["1d", 61, 39, "bullish"],
      ]),
      globalLongPercent: 68,
      globalShortPercent: 32,
      pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish", nearestSupport: 98, nearestResistance: 109 }),
      trendlineOutput: makeTL(),
      structureState: "breakout",
      emaContext: {
        ema20: 102,
        ema50: 99,
        ema200: 96,
        priceAboveEma20: true,
        priceAboveEma50: true,
        bullishAligned: true,
        bearishAligned: false,
        ema20Slope: 0.6,
        ema50Slope: 0.25,
        ema200Slope: 0.1,
      },
      volumeContext: {
        currentVolume: 1900,
        averageVolume: 1000,
        relativeVolume: 1.9,
        bullVolumeRatio: 0.68,
        bearVolumeRatio: 0.32,
        trend: "expanding",
        breakoutConfirmed: true,
      },
      candleConfirmation: {
        bullishBreakoutConfirmed: true,
        bearishBreakdownConfirmed: false,
        bullishRetestConfirmed: false,
        bearishRetestConfirmed: false,
        lastCandleDirection: "bullish",
        bodyStrength: 72,
        closeLocation: 0.86,
        summary: "CHOCH reversal breakout đã được xác nhận.",
      },
      currentPrice: 104,
      atr: 3.5,
      nearestSupport: 98,
      nearestResistance: 109,
      latestSwingLow: 98.5,
      currentTime: Date.now(),
    });

    assert(result.direction === "long", "CHOCH reversal flips direction to long");
    assert((result.tradeQualityScore || 0) >= 60, "CHOCH reversal with confirmation has acceptable quality");
  }
}
