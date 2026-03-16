import { ScoringEngine } from "../src/engines/ScoringEngine";
import { AssertFn } from "./helpers";
import { PivotRelation, TrendlineEngineOutput, PatternSignal } from "../src/types";

function makePivotRelation(overrides: Partial<PivotRelation> = {}): PivotRelation {
  return {
    levels: { pivot: 100, r1: 110, s1: 90, r2: 120, s2: 80, r3: 130, s3: 70 },
    state: "below_pivot",
    distanceToPivot: -5,
    distanceToPivotPercent: 5,
    nearestResistance: 100,
    nearestSupport: 90,
    targetHint: 100,
    directionBias: "bearish",
    narrative: "Test narrative",
    ...overrides,
  };
}

function makeTrendlineOutput(overrides: Partial<TrendlineEngineOutput> = {}): TrendlineEngineOutput {
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

export function testScoringEngine(assert: AssertFn) {
  const engine = new ScoringEngine();

  // Test: basic scoring
  {
    const score = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "1h",
      patternSignals: [],
      pivotRelation: makePivotRelation(),
      trendlineOutput: makeTrendlineOutput(),
      structureState: "downtrend",
      currentPrice: 95,
    });

    assert(score.longScore + score.shortScore === 100, "Long + Short = 100");
    assert(score.shortScore > score.longScore, "Bearish structure + below pivot = short dominant");
    assert(score.dominantBias === "bearish", "Dominant bias is bearish");
  }

  // Test: bullish scenario
  {
    const score = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "1h",
      patternSignals: [{
        pattern: "bullish_engulfing",
        direction: "bullish",
        strength: 70,
        candleIndex: 10,
        isConfirmed: true,
        contextBoost: 5,
        notes: [],
      }],
      pivotRelation: makePivotRelation({
        state: "above_pivot",
        directionBias: "bullish",
      }),
      trendlineOutput: makeTrendlineOutput({ trendlineBias: "bullish" }),
      structureState: "uptrend",
      momentumScore: 70,
      currentPrice: 105,
    });

    assert(score.longScore > score.shortScore, "Bullish setup = long > short");
    assert(score.dominantBias === "bullish", "Dominant bias is bullish");
  }

  // Test: neutral zone
  {
    const score = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "1h",
      patternSignals: [],
      pivotRelation: makePivotRelation({
        state: "at_pivot",
        directionBias: "neutral",
      }),
      trendlineOutput: makeTrendlineOutput(),
      structureState: "range",
      currentPrice: 100,
    });

    assert(
      Math.abs(score.longScore - score.shortScore) < 15,
      "Range + at pivot = roughly neutral"
    );
  }

  // Test: aggregation
  {
    const scores = [
      engine.scoreTimeframe({
        symbol: "BTCUSDT",
        timeframe: "15m",
        patternSignals: [],
        pivotRelation: makePivotRelation({ state: "above_pivot", directionBias: "bullish" }),
        trendlineOutput: makeTrendlineOutput(),
        structureState: "uptrend",
        currentPrice: 105,
      }),
      engine.scoreTimeframe({
        symbol: "BTCUSDT",
        timeframe: "4h",
        patternSignals: [],
        pivotRelation: makePivotRelation({ state: "below_pivot", directionBias: "bearish" }),
        trendlineOutput: makeTrendlineOutput(),
        structureState: "downtrend",
        currentPrice: 95,
      }),
      engine.scoreTimeframe({
        symbol: "BTCUSDT",
        timeframe: "1d",
        patternSignals: [],
        pivotRelation: makePivotRelation({ state: "below_pivot", directionBias: "bearish" }),
        trendlineOutput: makeTrendlineOutput(),
        structureState: "downtrend",
        currentPrice: 95,
      }),
    ];

    const agg = engine.aggregate(scores);
    assert(agg.globalLongPercent + agg.globalShortPercent === 100, "Global sums to 100");
    assert(
      agg.globalShortPercent > agg.globalLongPercent,
      "Big frames bearish outweighs small frame bullish"
    );
  }

  // Test: volatility penalty
  {
    const score = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "1h",
      patternSignals: [],
      pivotRelation: makePivotRelation(),
      trendlineOutput: makeTrendlineOutput(),
      structureState: "downtrend",
      volatilityScore: 95,
      currentPrice: 95,
    });

    assert(score.confidence > 0, "Confidence still positive despite high vol");
  }

  // Test: SR penalty
  {
    const scoreWithSR = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "1h",
      patternSignals: [{
        pattern: "bullish_engulfing",
        direction: "bullish",
        strength: 70,
        candleIndex: 10,
        isConfirmed: true,
        contextBoost: 0,
        notes: [],
      }],
      pivotRelation: makePivotRelation({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTrendlineOutput(),
      structureState: "uptrend",
      srContext: {
        nearestResistance: 106,
        resistanceDistance: 1,
      },
      atr: 5,
      currentPrice: 105,
    });

    assert(scoreWithSR.longScore > 0, "Long score exists even with SR penalty");
  }

  // Test: EMA and volume confirmation strengthen bullish score
  {
    const score = engine.scoreTimeframe({
      symbol: "BTCUSDT",
      timeframe: "4h",
      patternSignals: [],
      pivotRelation: makePivotRelation({ state: "above_pivot", directionBias: "bullish" }),
      trendlineOutput: makeTrendlineOutput(),
      structureState: "uptrend",
      emaContext: {
        ema20: 104,
        ema50: 101,
        ema200: 96,
        priceAboveEma20: true,
        priceAboveEma50: true,
        bullishAligned: true,
        bearishAligned: false,
        ema20Slope: 0.8,
        ema50Slope: 0.5,
        ema200Slope: 0.2,
      },
      volumeContext: {
        currentVolume: 1800,
        averageVolume: 1000,
        relativeVolume: 1.8,
        bullVolumeRatio: 0.65,
        bearVolumeRatio: 0.35,
        trend: "expanding",
        breakoutConfirmed: true,
      },
      momentumScore: 68,
      currentPrice: 105,
    });

    assert(score.longScore > score.shortScore, "EMA and bullish volume reinforce long bias");
    assert(score.components.ema > 0, "EMA component contributes positively");
    assert(score.components.volume > 0, "Volume component contributes positively");
  }
}
