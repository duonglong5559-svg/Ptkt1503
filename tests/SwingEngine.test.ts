import { SwingEngine } from "../src/engines/SwingEngine";
import { makeCandle, generateSwingTrendCandles, AssertFn } from "./helpers";
import { Candle } from "../src/types";

export function testSwingEngine(assert: AssertFn) {
  const engine = new SwingEngine();

  // Test: detect swing highs and lows in zigzag pattern
  {
    const candles: Candle[] = [];
    const prices = [100, 102, 105, 108, 106, 103, 100, 98, 101, 104, 107, 110, 108, 105, 102];
    for (let i = 0; i < prices.length; i++) {
      const p = prices[i];
      candles.push(
        makeCandle({
          open: p - 0.5,
          high: p + 1,
          low: p - 1,
          close: p + 0.5,
          openTime: Date.now() - (prices.length - i) * 3600000,
          closeTime: Date.now() - (prices.length - i - 1) * 3600000,
        })
      );
    }

    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });

    assert(result.swingHighs.length > 0, "Detects swing highs");
    assert(result.swingLows.length > 0, "Detects swing lows");
    assert(result.allSwings.length > 0, "All swings populated");
  }

  // Test: insufficient data
  {
    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: [makeCandle({ open: 100, high: 101, low: 99, close: 100.5 })],
    });
    assert(result.swingHighs.length === 0, "No swings from insufficient data");
  }

  // Test: lookback parameter
  {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      const p = 100 + Math.sin(i * 0.8) * 10;
      candles.push(
        makeCandle({
          open: p - 0.3,
          high: p + 1.5,
          low: p - 1.5,
          close: p + 0.3,
          openTime: Date.now() - (20 - i) * 3600000,
          closeTime: Date.now() - (20 - i - 1) * 3600000,
        })
      );
    }

    const result2 = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 2,
    });
    const result5 = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
      lookback: 5,
    });

    assert(
      result2.swingHighs.length >= result5.swingHighs.length,
      "Smaller lookback finds more (or equal) swing points"
    );
  }

  // Test: swing strength
  {
    const candles: Candle[] = [];
    for (let i = 0; i < 15; i++) {
      const p = 100 + Math.sin(i * 0.6) * 8;
      candles.push(
        makeCandle({
          open: p - 0.5,
          high: p + 2,
          low: p - 2,
          close: p + 0.5,
          openTime: Date.now() - (15 - i) * 3600000,
          closeTime: Date.now() - (15 - i - 1) * 3600000,
        })
      );
    }

    const result = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles,
    });

    for (const sw of result.allSwings) {
      assert(
        sw.strength >= 0 && sw.strength <= 100,
        `Swing at index ${sw.index} has valid strength (${sw.strength})`
      );
    }
  }

  // Test: forming candle does not create extra swings
  {
    const closedCandles = generateSwingTrendCandles([100, 112, 103, 116, 106, 120, 109], 3);
    const forming = makeCandle({
      open: 109,
      high: 125,
      low: 104,
      close: 123,
      openTime: closedCandles[closedCandles.length - 1].closeTime,
      closeTime: closedCandles[closedCandles.length - 1].closeTime + 3600000,
      isClosed: false,
    });

    const closedOnly = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: closedCandles,
      lookback: 2,
    });
    const withForming = engine.analyze({
      symbol: "BTCUSDT",
      timeframe: "1h",
      candles: [...closedCandles, forming],
      lookback: 2,
    });

    assert(
      withForming.allSwings.length === closedOnly.allSwings.length,
      "Forming candle does not add new swing points"
    );
    assert(
      withForming.latestSwingHigh?.index === closedOnly.latestSwingHigh?.index,
      "Latest swing high ignores forming candle"
    );
    assert(
      withForming.latestSwingLow?.index === closedOnly.latestSwingLow?.index,
      "Latest swing low ignores forming candle"
    );
  }
}
