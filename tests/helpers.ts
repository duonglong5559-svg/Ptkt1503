import { Candle } from "../src/types";

export type AssertFn = (condition: boolean, name: string) => void;

export function makeCandle(
  overrides: Partial<Candle> & { open: number; high: number; low: number; close: number }
): Candle {
  return {
    symbol: "BTCUSDT",
    timeframe: "1h",
    openTime: Date.now() - 3600000,
    closeTime: Date.now(),
    volume: 1000,
    isClosed: true,
    ...overrides,
  };
}

export function generateTrendCandles(
  direction: "up" | "down",
  count: number,
  startPrice: number,
  step: number
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const open = price;
    const range = step * 0.5;

    if (direction === "up") {
      price += step;
      candles.push(
        makeCandle({
          open,
          high: price + range * 0.3,
          low: open - range * 0.2,
          close: price,
          openTime: Date.now() - (count - i) * 3600000,
          closeTime: Date.now() - (count - i - 1) * 3600000,
        })
      );
    } else {
      price -= step;
      candles.push(
        makeCandle({
          open,
          high: open + range * 0.2,
          low: price - range * 0.3,
          close: price,
          openTime: Date.now() - (count - i) * 3600000,
          closeTime: Date.now() - (count - i - 1) * 3600000,
        })
      );
    }
  }

  return candles;
}

export function generateRangeCandles(
  count: number,
  centerPrice: number,
  amplitude: number
): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const offset = Math.sin(i * 0.5) * amplitude;
    const open = centerPrice + offset;
    const close = centerPrice + offset + (Math.random() - 0.5) * amplitude * 0.3;
    const high = Math.max(open, close) + Math.random() * amplitude * 0.2;
    const low = Math.min(open, close) - Math.random() * amplitude * 0.2;
    candles.push(
      makeCandle({
        open,
        high,
        low,
        close,
        openTime: Date.now() - (count - i) * 3600000,
        closeTime: Date.now() - (count - i - 1) * 3600000,
      })
    );
  }
  return candles;
}
