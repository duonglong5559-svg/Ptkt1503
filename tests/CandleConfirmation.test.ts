import { AssertFn, makeCandle } from "./helpers";
import { CandleStateManager } from "../src/services/CandleStateManager";
import { PatternEngine } from "../src/engines/PatternEngine";
import { Candle } from "../src/types";

export function testCandleConfirmation(assert: AssertFn): void {
  // CandleStateManager: forming candle does not trigger close
  const mgr = new CandleStateManager();
  let closedCount = 0;
  mgr.setOnCandleClose(() => { closedCount++; });

  const forming: Candle = makeCandle({ open: 100, high: 105, low: 99, close: 103, isClosed: false, openTime: 1000 });
  const result1 = mgr.update("1h", forming);
  assert(result1.closed === false, "Forming candle does not trigger close");
  assert(closedCount === 0, "No close callback for forming candle");

  // Update with same forming candle (price change)
  const forming2: Candle = { ...forming, close: 104, high: 106 };
  const result2 = mgr.update("1h", forming2);
  assert(result2.closed === false, "Updated forming candle still not closed");

  // New candle arrives (new openTime) -> previous candle should close
  const newForming: Candle = makeCandle({ open: 104, high: 107, low: 103, close: 105, isClosed: false, openTime: 2000 });
  const result3 = mgr.update("1h", newForming);
  assert(result3.closed === true, "New openTime triggers previous candle close");
  assert(closedCount === 1, "Close callback fired once");
  assert(result3.closedCandle?.isClosed === true, "Closed candle has isClosed=true");

  // Explicit close
  const closed: Candle = makeCandle({ open: 104, high: 107, low: 103, close: 106, isClosed: true, openTime: 2000 });
  const result4 = mgr.update("1h", closed);
  assert(result4.closed === true, "isClosed=true triggers close");
  assert(closedCount === 2, "Close callback fired again");

  // getForming returns undefined after close
  const formingCheck = mgr.getForming("BTCUSDT", "1h");
  assert(formingCheck === undefined, "No forming candle after close");

  // PatternEngine: only uses closed candles
  const engine = new PatternEngine();
  const candles: Candle[] = [];
  for (let i = 0; i < 20; i++) {
    candles.push(makeCandle({
      open: 100 + i, high: 102 + i, low: 99 + i, close: 101 + i,
      isClosed: true,
      openTime: Date.now() - (20 - i) * 3600000,
    }));
  }
  // Add a forming candle at the end
  candles.push(makeCandle({
    open: 120, high: 130, low: 110, close: 115,
    isClosed: false,
    openTime: Date.now(),
  }));

  const output = engine.analyze({
    symbol: "BTCUSDT",
    timeframe: "1h",
    candles,
    currentTrendHint: "neutral",
    atr: 2,
  });

  // Patterns should reference closed candle indices, not the forming candle
  for (const p of output.patterns) {
    assert(p.candleIndex < 20, `Pattern index ${p.candleIndex} is within closed candle range`);
  }
  assert(output.patterns.every(p => p.isConfirmed), "All patterns are confirmed (from closed candles)");
}
