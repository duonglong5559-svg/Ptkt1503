import { AssertFn, generateTrendCandles } from "./helpers";
import { SignalEngine } from "../src/engines/SignalEngine";
import { Pipeline } from "../src/services/Pipeline";

export function testSignalSanity(assert: AssertFn): void {
  const engine = new SignalEngine();

  // Long SL must be below entry
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: [
        { symbol: "BTCUSDT", timeframe: "4h", longScore: 70, shortScore: 30, dominantBias: "bullish", components: { pattern: 5, pivot: 5, trendline: 5, structure: 10, momentum: 5, volatility: 0, sr: 0 }, confidence: 70, summary: [], updatedAt: Date.now() },
        { symbol: "BTCUSDT", timeframe: "1d", longScore: 65, shortScore: 35, dominantBias: "bullish", components: { pattern: 5, pivot: 5, trendline: 5, structure: 10, momentum: 5, volatility: 0, sr: 0 }, confidence: 65, summary: [], updatedAt: Date.now() },
      ],
      globalLongPercent: 70,
      globalShortPercent: 30,
      pivotRelation: {
        levels: { pivot: 71000, r1: 72000, s1: 70000, r2: 73000, s2: 69000, r3: 74000, s3: 68000 },
        state: "above_pivot",
        distanceToPivot: 500,
        distanceToPivotPercent: 0.7,
        nearestResistance: 72000,
        nearestSupport: 70000,
        targetHint: 72000,
        directionBias: "bullish",
        narrative: "Above pivot",
      },
      trendlineOutput: { symbol: "BTCUSDT", timeframe: "4h", activeTrendlines: [], nearbyTrendlines: [], trendlineCount: 0, trendlineBias: "neutral", summary: "", updatedAt: Date.now() },
      structureState: "uptrend",
      currentPrice: 71500,
      atr: 300,
      nearestSupport: 70000,
      nearestResistance: 72000,
      latestSwingHigh: 72500,
      latestSwingLow: 70200,
      currentTime: Date.now(),
    });

    if (result.direction === "long" && result.entryLong && result.stopLoss) {
      assert(result.stopLoss < result.entryLong, `Long SL (${result.stopLoss}) must be below entry (${result.entryLong})`);
    } else {
      assert(true, "Long SL test skipped (no long signal produced)");
    }
  }

  // Short SL must be above entry
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: [
        { symbol: "BTCUSDT", timeframe: "4h", longScore: 30, shortScore: 70, dominantBias: "bearish", components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 70, summary: [], updatedAt: Date.now() },
        { symbol: "BTCUSDT", timeframe: "1d", longScore: 35, shortScore: 65, dominantBias: "bearish", components: { pattern: 0, pivot: 0, trendline: 0, structure: 0, momentum: 0, volatility: 0, sr: 0 }, confidence: 65, summary: [], updatedAt: Date.now() },
      ],
      globalLongPercent: 30,
      globalShortPercent: 70,
      pivotRelation: {
        levels: { pivot: 71000, r1: 72000, s1: 70000, r2: 73000, s2: 69000, r3: 74000, s3: 68000 },
        state: "below_pivot",
        distanceToPivot: -500,
        distanceToPivotPercent: 0.7,
        nearestResistance: 71000,
        nearestSupport: 69500,
        targetHint: 69500,
        directionBias: "bearish",
        narrative: "Below pivot",
      },
      trendlineOutput: { symbol: "BTCUSDT", timeframe: "4h", activeTrendlines: [], nearbyTrendlines: [], trendlineCount: 0, trendlineBias: "neutral", summary: "", updatedAt: Date.now() },
      structureState: "downtrend",
      currentPrice: 70500,
      atr: 300,
      nearestSupport: 69500,
      nearestResistance: 71000,
      latestSwingHigh: 71800,
      latestSwingLow: 69200,
      currentTime: Date.now(),
    });

    if (result.direction === "short" && result.entryShort && result.stopLoss) {
      assert(result.stopLoss > result.entryShort, `Short SL (${result.stopLoss}) must be above entry (${result.entryShort})`);
    } else {
      assert(true, "Short SL test skipped (no short signal produced)");
    }
  }

  // Target must not equal entry for valid setups
  {
    const result = engine.evaluate({
      symbol: "BTCUSDT",
      timeframeScores: [
        { symbol: "BTCUSDT", timeframe: "4h", longScore: 70, shortScore: 30, dominantBias: "bullish", components: { pattern: 5, pivot: 5, trendline: 5, structure: 10, momentum: 5, volatility: 0, sr: 0 }, confidence: 70, summary: [], updatedAt: Date.now() },
      ],
      globalLongPercent: 70,
      globalShortPercent: 30,
      pivotRelation: {
        levels: { pivot: 71000, r1: 72000, s1: 70000, r2: 73000, s2: 69000, r3: 74000, s3: 68000 },
        state: "above_pivot",
        distanceToPivot: 500,
        distanceToPivotPercent: 0.7,
        nearestResistance: 72000,
        nearestSupport: 70000,
        targetHint: 72000,
        directionBias: "bullish",
        narrative: "Above pivot",
      },
      trendlineOutput: { symbol: "BTCUSDT", timeframe: "4h", activeTrendlines: [], nearbyTrendlines: [], trendlineCount: 0, trendlineBias: "neutral", summary: "", updatedAt: Date.now() },
      structureState: "uptrend",
      currentPrice: 71500,
      atr: 300,
      nearestSupport: 70000,
      nearestResistance: 72000,
      currentTime: Date.now(),
    });

    if (result.direction !== "neutral" && result.target && result.entryLong) {
      assert(result.target !== result.entryLong, `Target (${result.target}) must differ from entry (${result.entryLong})`);
    } else if (result.direction !== "neutral" && result.target && result.entryShort) {
      assert(result.target !== result.entryShort, `Target (${result.target}) must differ from entry (${result.entryShort})`);
    } else {
      assert(true, "Target != entry test: no entry/target to compare");
    }
  }

  // Trendline count capped at 5 in pipeline
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles1h = generateTrendCandles("down", 100, 75000, 5);
    const candles4h = generateTrendCandles("down", 60, 76000, 8);
    const candles1d = generateTrendCandles("down", 40, 77000, 12);
    pipeline.initializeCache("1h", candles1h);
    pipeline.initializeCache("4h", candles4h);
    pipeline.initializeCache("1d", candles1d);

    const payload = pipeline.runFullAnalysis(candles1h[candles1h.length - 1].close);
    assert(payload.trendlineCount <= 5, `Trendline count (${payload.trendlineCount}) must be <= 5`);
  }
}
