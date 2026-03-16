import { TrendlineEngine } from "../src/engines/TrendlineEngine";
import { SwingEngine } from "../src/engines/SwingEngine";
import { generateSwingTrendCandles, AssertFn } from "./helpers";

export function testTrendlineEngine(assert: AssertFn) {
  const trendlineEngine = new TrendlineEngine();
  const swingEngine = new SwingEngine();

  // Test: ascending support is detected from higher lows
  {
    const candles = generateSwingTrendCandles([100, 114, 104, 118, 108, 122, 112, 126, 116, 130], 3);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
      atr: 4,
    });

    assert(
      result.activeTrendlines.some((line) => line.type === "ascending_support"),
      "Detects ascending support in uptrend swings"
    );
    assert(result.primarySupport?.type === "ascending_support", "Primary support selected");
    assert(
      (result.primarySupport?.projectedPriceNow || 0) < candles[candles.length - 1].close,
      "Primary support remains below current price"
    );
    assert((result.primarySupport?.touches || 0) >= 3, "Primary support has repeated swing touches");
  }

  // Test: descending resistance is detected from lower highs
  {
    const candles = generateSwingTrendCandles([130, 116, 126, 112, 122, 108, 118, 104, 114, 100], 3);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
      atr: 4,
    });

    assert(
      result.activeTrendlines.some((line) => line.type === "descending_resistance"),
      "Detects descending resistance in downtrend swings"
    );
    assert(result.primaryResistance?.type === "descending_resistance", "Primary resistance selected");
    assert(
      (result.primaryResistance?.projectedPriceNow || 0) > candles[candles.length - 1].close,
      "Primary resistance remains above current price"
    );
  }

  // Test: empty swings
  {
    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: [],
      swings: [],
      currentPrice: 100,
      currentIndex: 0,
    });
    assert(result.trendlineCount === 0, "No trendlines from empty data");
    assert(result.trendlineBias === "neutral", "Empty = neutral bias");
  }

  // Test: max active lines limited
  {
    const candles = generateSwingTrendCandles([100, 114, 104, 118, 108, 122, 112, 126, 116, 130, 120, 134], 3);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });

    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
    });

    assert(
      result.activeTrendlines.length <= 4,
      `Active trendlines limited (got ${result.activeTrendlines.length})`
    );
  }

  // Test: intrabar move should not mark support as broken before candle close
  {
    const candles = generateSwingTrendCandles([100, 114, 104, 118, 108, 122, 112, 126, 116, 130], 3);
    const swings = swingEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });

    const base = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: candles[candles.length - 1].close,
      currentIndex: candles.length - 1,
      atr: 4,
    });

    const support = base.primarySupport;
    const intrabarBreakPrice = (support?.projectedPriceNow || candles[candles.length - 1].close) - 6;
    const result = trendlineEngine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      swings: swings.allSwings,
      currentPrice: intrabarBreakPrice,
      currentIndex: candles.length - 1,
      atr: 4,
    });

    assert(!!support, "Primary support exists for intrabar break test");
    assert(
      result.primarySupport?.isBroken === false,
      "Support is not confirmed broken by intrabar price only"
    );
  }
}
