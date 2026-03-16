import { SignalEngine } from "../src/engines/SignalEngine";
import { AssertFn } from "./helpers";
import {
  PivotRelation,
  Trendline,
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

function makeLine(overrides: Partial<Trendline> = {}): Trendline {
  return {
    id: "tl-1",
    type: "ascending_support",
    points: { x1: 1, y1: 5090, x2: 2, y2: 5100 },
    slope: 1,
    intercept: 5089,
    touches: 3,
    strength: 70,
    isBroken: false,
    lastInteraction: "touch",
    distanceToPrice: 0,
    distanceToPricePercent: 0,
    projectedPriceNow: 5090,
    normalizedDistance: 0.1,
    proximity: "touch_zone",
    visualState: "hot",
    tier: "primary",
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeScores(bias: "bullish" | "bearish"): TimeframeScore[] {
  const isB = bias === "bearish";
  return [
    { symbol: "BTCUSDT", timeframe: "15m", longScore: isB ? 42 : 58, shortScore: isB ? 58 : 42, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 60, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "1h", longScore: isB ? 35 : 65, shortScore: isB ? 65 : 35, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 65, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "4h", longScore: isB ? 25 : 75, shortScore: isB ? 75 : 25, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 70, summary: [], updatedAt: Date.now() },
    { symbol: "BTCUSDT", timeframe: "1d", longScore: isB ? 30 : 70, shortScore: isB ? 70 : 30, dominantBias: bias, components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 72, summary: [], updatedAt: Date.now() },
  ];
}

export function testSignalEngine(assert: AssertFn) {
  const engine = new SignalEngine();

  // Test: idle when no strong bias
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: [
        { symbol: "BTCUSDT", timeframe: "1h", longScore: 52, shortScore: 48, dominantBias: "neutral", components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 50, summary: [], updatedAt: Date.now() },
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

  // Test: ready setup can trigger immediately on the same evaluation
  {
    const supportLine = makeLine();
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 68,
      globalShortPercent: 32,
      pivotRelation: makePivot({
        state: "above_pivot",
        directionBias: "bullish",
        nearestSupport: 5090,
        nearestResistance: 5200,
      }),
      trendlineOutput: makeTL({
        activeTrendlines: [supportLine],
        trendlineCount: 1,
        primarySupport: supportLine,
      }),
      structureState: "uptrend",
      currentPrice: 5090,
      atr: 15,
      nearestSupport: 5090,
      currentTime: Date.now(),
    });

    assert(result.state === "triggered_long", `Touch-zone support triggers immediately (got ${result.state})`);
  }

  // Test: active state persists across reevaluations
  {
    const prevActive = {
      ...engine.evaluate({
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
      }),
      state: "active_short" as const,
      direction: "short" as const,
      entryShort: 5100,
      stopLoss: 5130,
    };

    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 32,
      globalShortPercent: 68,
      pivotRelation: makePivot(),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5090,
      atr: 15,
      previousSignal: prevActive,
      currentTime: Date.now(),
    });

    assert(result.state === "active_short", "Active short remains active on subsequent evaluations");
  }

  // Test: invalidated signal clears directional setup data
  {
    const prevLong = {
      ...engine.evaluate({
        symbol: "BTCUSDT",
        timeframeScores: makeScores("bullish"),
        globalLongPercent: 72,
        globalShortPercent: 28,
        pivotRelation: makePivot({ state: "above_pivot", directionBias: "bullish" }),
        trendlineOutput: makeTL(),
        structureState: "uptrend",
        currentPrice: 5200,
        atr: 15,
        currentTime: Date.now(),
      }),
      state: "watch_long" as const,
      direction: "long" as const,
      entryLong: 5190,
      stopLoss: 5160,
    };

    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bearish"),
      globalLongPercent: 28,
      globalShortPercent: 72,
      pivotRelation: makePivot({ state: "below_pivot", directionBias: "bearish" }),
      trendlineOutput: makeTL(),
      structureState: "downtrend",
      currentPrice: 5150,
      atr: 15,
      previousSignal: prevLong,
      currentTime: Date.now(),
    });

    assert(result.state === "invalidated", "Bias flip invalidates prior long setup");
    assert(result.direction === "neutral", "Invalidated setup clears direction");
    assert(result.entryLong === undefined && result.entryShort === undefined, "Invalidated setup clears entries");
    assert(result.stopLoss === undefined && result.takeProfit === undefined, "Invalidated setup clears SL/TP");
  }

  // Test: broken support is ignored as long entry anchor
  {
    const brokenSupport = makeLine({
      id: "tl-broken",
      isBroken: true,
      lastInteraction: "break",
      projectedPriceNow: 100,
      proximity: "near",
      normalizedDistance: 0.8,
    });

    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 68,
      globalShortPercent: 32,
      pivotRelation: makePivot({
        levels: { pivot: 104, r1: 106, s1: 96, r2: 108, s2: 94, r3: 110, s3: 92 },
        state: "above_pivot",
        directionBias: "bullish",
        nearestSupport: undefined,
        nearestResistance: 106,
      }),
      trendlineOutput: makeTL({
        activeTrendlines: [brokenSupport],
        trendlineCount: 1,
        primarySupport: brokenSupport,
      }),
      structureState: "uptrend",
      currentPrice: 105,
      atr: 10,
      currentTime: Date.now(),
    });

    assert(result.entryLong !== 100, "Broken support is not used as long entry");
  }

  // Test: take-profit ignores wrong-sided pivot levels
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: makeScores("bullish"),
      globalLongPercent: 68,
      globalShortPercent: 32,
      pivotRelation: makePivot({
        levels: { pivot: 93, r1: 94, s1: 92, r2: 95, s2: 91, r3: 96, s3: 90 },
        state: "above_pivot",
        directionBias: "bullish",
        nearestSupport: 100,
        nearestResistance: 95,
        targetHint: 94,
      }),
      trendlineOutput: makeTL(),
      structureState: "uptrend",
      currentPrice: 110,
      atr: 5,
      nearestSupport: 100,
      nearestResistance: 95,
      latestSwingLow: 98,
      currentTime: Date.now(),
    });

    assert(result.entryLong !== undefined, "Long entry exists for TP sanity test");
    assert(result.takeProfit !== undefined && result.entryLong !== undefined && result.takeProfit > result.entryLong, "Take-profit stays above long entry");
  }
}
