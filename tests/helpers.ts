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

export function generateSwingTrendCandles(
  pivots: number[],
  candlesPerLeg: number = 3
): Candle[] {
  const candles: Candle[] = [];
  if (pivots.length < 2) return candles;

  let lastClose = pivots[0];
  let time = Date.now() - pivots.length * candlesPerLeg * 3600000;

  for (let leg = 0; leg < pivots.length - 1; leg++) {
    const start = pivots[leg];
    const end = pivots[leg + 1];

    for (let step = 1; step <= candlesPerLeg; step++) {
      const close = start + ((end - start) * step) / candlesPerLeg;
      const open = lastClose;
      const isRising = close >= open;
      const high = Math.max(open, close) + (isRising ? 1.2 : 0.6);
      const low = Math.min(open, close) - (isRising ? 0.6 : 1.2);
      candles.push(
        makeCandle({
          open,
          high,
          low,
          close,
          openTime: time,
          closeTime: time + 3600000,
        })
      );
      lastClose = close;
      time += 3600000;
    }
  }

  return candles;
}
