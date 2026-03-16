import { SignalEngine } from "../src/engines/SignalEngine";
import { AssertFn } from "./helpers";
import {
  PivotRelation,
  TrendlineEngineOutput,
  TimeframeScore,
} from "../src/types";

function makePivot(overrides: Partial<PivotRelation> = {}): PivotRelation {
  return {
    levels: { pivot: 5145, r1: 5200, s1: 5090, r2: 5255, s2: 5035, r3: 5310, s3: 4980 },
    state: "below_pivot",
    distanceToPivot: -37,
    distanceToPivotPercent: 0.72,
    nearestResistance: 5145,
    nearestSupport: 5090,
    targetHint: 5145,
    directionBias: "bearish",
    narrative: "Giá đang ở phía dưới Pivot (5145.00), có xu hướng tiến về Pivot.",
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

function makeScores(bias: "bullish" | "bearish"): TimeframeScore[] {
  const isB = bias === "bearish";
  return [
    { symbol: "BTCUSDT", timeframe: "15m", longScore: isB ? 42 : 58, shortScore: isB ? 58 : 42, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 }, confidence: 60, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "1h", longScore: isB ? 35 : 65, shortScore: isB ? 65 : 35, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 }, confidence: 65, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "4h", longScore: isB ? 25 : 75, shortScore: isB ? 75 : 25, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 }, confidence: 70, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "1d", longScore: isB ? 30 : 70, shortScore: isB ? 70 : 30, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 }, confidence: 72, summary: [], updatedAt: Date.now() },
  ];
}

export function testSignalEngine(assert: AssertFn) {
  const engine = new SignalEngine();

  // Test: idle when no strong bias
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: [
        { symbol: "BTCUSDT", timeframe: "1h", longScore: 52, shortScore: 48, dominantBias: "neutral", components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, ema: 0, volume: 0, volatility: 0, sr: 0 }, confidence: 50, summary: [], updatedAt: Date.now() },
      ],
      globalLongPercent: 52,
      globalShortPercent: 48,
      pivotRelation: makePivot({ state: "at_pivot", directionBias: "neutral" }),
      trendlineOutput: makeTL(),
      structureState: "range",
      currentPrice: 5145,
      currentTime: Date.now(),
    });

    assert(result.state === "idle", "Idle state when no strong bias");
    assert(result.direction === "neutral", "Neutral direction when idle");
  }

  // Test: watch_short with bearish bias
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5108,
      atr: 15,
      currentTime: Date.now(),
    });

    assert(
      result.state === "watch_short" || result.state === "ready_short",
      `Bearish bias produces watch/ready short (got ${result.state})`
    );
    assert(result.direction === "short", "Direction is short");
    assert(result.entryShort !== undefined, "Entry short is defined");
    assert(result.stopLoss !== undefined, "Stop loss is defined");
  }

  // Test: watch_long with bullish bias
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 68,
      globalShortPercent: 32,
      pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTL(),
      structureState: "uptrend",
      currentPrice: 5200,
      atr: 15,
      currentTime: Date.now(),
    });

    assert(
      result.state === "watch_long" || result.state === "ready_long",
      `Bullish bias produces watch/ready long (got ${result.state})`
    );
    assert(result.direction === "long", "Direction is long");
  }

  // Test: summary text generation
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5108,
      atr: 15,
      currentTime: Date.now(),
    });

    assert(result.summaryText.length > 0, "Summary text is non-empty");
    assert(result.detailText.length > 0, "Detail text is non-empty");
    assert(result.steps.length === 4, "Signal has 4 steps");
    assert(result.overallConfidence > 0, "Overall confidence is positive");
  }

  // Test: cooldown prevents signal
  {
    const prev = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5108,
      atr: 15,
      currentTime: Date.now(),
    });

    const withCooldown = {
      ...prev,
      cooldownUntil: Date.now() + 300000,
    };

    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5108,
      atr: 15,
      previousSignal: withCooldown,
      currentTime: Date.now(),
    });

    assert(result.state === "cooldown", "Cooldown forces cooldown state");
  }

  // Test: invalidation on bias flip
  {
    const prevShort = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5108,
      atr: 15,
      currentTime: Date.now(),
    });

    const flipped = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 72,
      globalShortPercent: 28,
      pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTL(),
      structureState: "uptrend",
      currentPrice: 5200,
      atr: 15,
      previousSignal: prevShort,
      currentTime: Date.now(),
    });

    assert(
      flipped.state === "invalidated" || flipped.direction === "long",
      "Bias flip either invalidates or switches direction"
    );
  }

  // Test: EMA misalignment blocks bullish watch state
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 69,
      globalShortPercent: 31,
      pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTL(),
      structureState: "uptrend",
      emaContext: {
        ema20: 5200,
        ema50: 5240,
        ema200: 5300,
        priceAboveEma20: false,
        priceAboveEma50: false,
        bullishAligned: false,
        bearishAligned: true,
        ema20Slope: -0.4,
        ema50Slope: -0.2,
        ema200Slope: -0.1,
      },
      currentPrice: 5180,
      atr: 15,
      currentTime: Date.now(),
    });

    assert(result.state === "idle", "Bearish EMA alignment blocks bullish setup");
  }
}
