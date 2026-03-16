import { Pipeline } from "../src/services/Pipeline";
import { generateTrendCandles, generateRangeCandles, AssertFn } from "./helpers";

export function testPipeline(assert: AssertFn) {
  // Test: full pipeline with downtrend data
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles1h = generateTrendCandles("down", 100, 5300, 2);
    const candles4h = generateTrendCandles("down", 50, 5400, 5);
    const candles1d = generateTrendCandles("down", 30, 5500, 10);

    pipeline.initializeCache("1h", candles1h);
    pipeline.initializeCache("4h", candles4h);
    pipeline.initializeCache("1d", candles1d);

    const currentPrice = candles1h[candles1h.length - 1].close;
    const payload = pipeline.runFullAnalysis(currentPrice);

    assert(payload.symbol === "BTCUSDT", "Pipeline symbol correct");
    assert(payload.displaySymbol !== undefined, "displaySymbol present");
    assert(payload.currentPrice === currentPrice, "Current price correct");
    assert(
      payload.globalBias.long + payload.globalBias.short === 100,
      "Global bias sums to 100"
    );
    assert(Object.keys(payload.timeframes).length > 0, "Timeframe data present");
    assert(payload.signal.summary.length > 0, "Signal summary generated");
    assert(payload.signal.state !== undefined, "Signal state defined");
    assert(payload.feedHealth !== undefined, "feedHealth present in payload");
    assert(Array.isArray(payload.news), "news array present in payload");
    assert(payload.signal.confidenceLong >= 0, "confidenceLong present");
    assert(payload.signal.confidenceShort >= 0, "confidenceShort present");
  }

  // Test: pipeline with uptrend data
  {
    const pipeline = new Pipeline("ETHUSDT");
    const candles1h = generateTrendCandles("up", 100, 3000, 3);
    const candles4h = generateTrendCandles("up", 50, 2900, 8);
    const candles1d = generateTrendCandles("up", 30, 2800, 15);

    pipeline.initializeCache("1h", candles1h);
    pipeline.initializeCache("4h", candles4h);
    pipeline.initializeCache("1d", candles1d);

    const currentPrice = candles1h[candles1h.length - 1].close;
    const payload = pipeline.runFullAnalysis(currentPrice);

    assert(payload.symbol === "ETHUSDT", "Symbol correct for ETHUSDT");
    assert(payload.globalBias.long >= 0, "Long bias is non-negative");
  }

  // Test: candle update
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles = generateTrendCandles("down", 50, 5200, 2);
    pipeline.initializeCache("1h", candles);

    const newCandle = {
      symbol: "BTCUSDT",
      timeframe: "1h",
      openTime: Date.now(),
      closeTime: Date.now() + 3600000,
      open: 5100,
      high: 5105,
      low: 5095,
      close: 5098,
      volume: 500,
      isClosed: false,
    };
    pipeline.updateCandle("1h", newCandle);

    const state = pipeline.getState();
    const cache = state.candleCache.get("1h");
    assert(cache !== undefined, "Cache exists after update");
    assert(
      cache !== undefined && cache[cache.length - 1].close === 5098,
      "Latest candle updated"
    );
  }

  // Test: tick update returns null without full analysis
  {
    const pipeline = new Pipeline("BTCUSDT");
    const result = pipeline.runTickUpdate(5100);
    assert(result === null, "Tick update returns null before full analysis");
  }

  // Test: tick update after full analysis
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles1h = generateTrendCandles("down", 80, 5300, 2);
    pipeline.initializeCache("1h", candles1h);

    const price = candles1h[candles1h.length - 1].close;
    pipeline.runFullAnalysis(price);

    const tickPayload = pipeline.runTickUpdate(price - 5);
    assert(tickPayload !== null, "Tick update works after full analysis");
    if (tickPayload) {
      assert(tickPayload.currentPrice === price - 5, "Tick updates current price");
    }
  }

  // Test: tick update refreshes signal state transitions
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles1h = generateTrendCandles("down", 80, 5300, 2);
    const candles4h = generateTrendCandles("down", 50, 5400, 4);
    const candles1d = generateTrendCandles("down", 30, 5500, 8);
    pipeline.initializeCache("1h", candles1h);
    pipeline.initializeCache("4h", candles4h);
    pipeline.initializeCache("1d", candles1d);

    const price = candles1h[candles1h.length - 1].close;
    pipeline.runFullAnalysis(price);
    const state = pipeline.getState();
    state.lastSignal = {
      ...state.lastSignal!,
      state: "triggered_short",
      direction: "short",
      entryShort: price - 1,
      stopLoss: price + 10,
    };

    const tickPayload = pipeline.runTickUpdate(price - 3);
    assert(tickPayload !== null, "Tick payload exists for signal refresh test");
    assert(tickPayload?.signal.state === "active_short", `Tick update promotes triggered short to active (got ${tickPayload?.signal.state})`);
  }

  // Test: missing higher-timeframe pivot data degrades to neutral pivot
  {
    const pipeline = new Pipeline("BTCUSDT");
    const candles1h = generateTrendCandles("down", 80, 5300, 2);
    pipeline.initializeCache("1h", candles1h);

    pipeline.runFullAnalysis(candles1h[candles1h.length - 1].close);
    const tfResult = pipeline.getState().timeframeResults.get("1h");

    assert(tfResult?.pivotRelation.directionBias === "neutral", "Missing pivot source keeps pivot bias neutral");
    assert(
      !!tfResult?.pivotRelation.narrative.includes("Thiếu dữ liệu Pivot"),
      "Missing pivot source emits degraded pivot narrative"
    );
  }

  // Test: range market
  {
    const pipeline = new Pipeline("XAUUSD");
    const candles = generateRangeCandles(80, 2050, 15);
    pipeline.initializeCache("1h", candles);

    const currentPrice = candles[candles.length - 1].close;
    const payload = pipeline.runFullAnalysis(currentPrice);

    assert(
      payload.globalBias.long >= 0 && payload.globalBias.short >= 0,
      "Range market produces valid bias values"
    );
  }
}
