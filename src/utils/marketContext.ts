import { Candle } from "../types";
import { EMAContext, VolumeContext } from "../types/scoring";

function getClosedCandles(candles: Candle[]): Candle[] {
  return candles.filter((c) => c.isClosed);
}

export function computeEMA(values: number[], period: number): number | undefined {
  if (values.length < period) return undefined;

  const multiplier = 2 / (period + 1);
  let ema = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
  }
  return Math.round(ema * 100) / 100;
}

function computeSlope(values: number[], period: number, lookback: number = 5): number {
  if (values.length < period + lookback) return 0;
  const current = computeEMA(values, period);
  const previous = computeEMA(values.slice(0, values.length - lookback), period);
  if (!current || !previous || previous === 0) return 0;
  return Math.round((((current - previous) / previous) * 100) * 100) / 100;
}

export function computeEMAContext(candles: Candle[]): EMAContext {
  const closed = getClosedCandles(candles);
  const closes = closed.map((c) => c.close);
  const lastClose = closes[closes.length - 1] || 0;

  const ema20 = computeEMA(closes, 20);
  const ema50 = computeEMA(closes, 50);
  const ema200 = computeEMA(closes, 200);

  const ema20Slope = computeSlope(closes, 20);
  const ema50Slope = computeSlope(closes, 50);
  const ema200Slope = computeSlope(closes, 200);

  const priceAboveEma20 = ema20 !== undefined ? lastClose >= ema20 : false;
  const priceAboveEma50 = ema50 !== undefined ? lastClose >= ema50 : false;

  const bullishAligned =
    ema20 !== undefined &&
    ema50 !== undefined &&
    ema200 !== undefined &&
    lastClose >= ema20 &&
    ema20 >= ema50 &&
    ema50 >= ema200 &&
    ema20Slope > 0 &&
    ema50Slope >= 0;

  const bearishAligned =
    ema20 !== undefined &&
    ema50 !== undefined &&
    ema200 !== undefined &&
    lastClose <= ema20 &&
    ema20 <= ema50 &&
    ema50 <= ema200 &&
    ema20Slope < 0 &&
    ema50Slope <= 0;

  return {
    ema20,
    ema50,
    ema200,
    priceAboveEma20,
    priceAboveEma50,
    bullishAligned,
    bearishAligned,
    ema20Slope,
    ema50Slope,
    ema200Slope,
  };
}

export function computeVolumeContext(candles: Candle[], averagePeriod: number = 20): VolumeContext {
  const closed = getClosedCandles(candles);
  if (closed.length === 0) {
    return {
      currentVolume: 0,
      averageVolume: 0,
      relativeVolume: 1,
      bullVolumeRatio: 0.5,
      bearVolumeRatio: 0.5,
      trend: "flat",
      breakoutConfirmed: false,
    };
  }

  const last = closed[closed.length - 1];
  const previous = closed.slice(-Math.max(averagePeriod + 5, 10), -1);
  const averageVolume = previous.length > 0
    ? previous.reduce((sum, candle) => sum + candle.volume, 0) / previous.length
    : last.volume;

  const recentWindow = closed.slice(-10);
  const bullVolume = recentWindow
    .filter((c) => c.close >= c.open)
    .reduce((sum, candle) => sum + candle.volume, 0);
  const bearVolume = recentWindow
    .filter((c) => c.close < c.open)
    .reduce((sum, candle) => sum + candle.volume, 0);
  const totalRecentVolume = bullVolume + bearVolume || 1;

  const recentAvg = closed.slice(-5).reduce((sum, candle) => sum + candle.volume, 0) / Math.min(5, closed.length);
  const previousAvgWindow = closed.slice(-10, -5);
  const previousAvg = previousAvgWindow.length > 0
    ? previousAvgWindow.reduce((sum, candle) => sum + candle.volume, 0) / previousAvgWindow.length
    : recentAvg;

  let trend: VolumeContext["trend"] = "flat";
  if (previousAvg > 0) {
    if (recentAvg > previousAvg * 1.1) trend = "expanding";
    else if (recentAvg < previousAvg * 0.9) trend = "contracting";
  }

  const relativeVolume = averageVolume > 0
    ? Math.round((last.volume / averageVolume) * 100) / 100
    : 1;

  return {
    currentVolume: last.volume,
    averageVolume: Math.round(averageVolume * 100) / 100,
    relativeVolume,
    bullVolumeRatio: Math.round((bullVolume / totalRecentVolume) * 100) / 100,
    bearVolumeRatio: Math.round((bearVolume / totalRecentVolume) * 100) / 100,
    trend,
    breakoutConfirmed:
      relativeVolume >= 1.25 &&
      ((last.close >= last.open && bullVolume >= bearVolume) ||
        (last.close < last.open && bearVolume >= bullVolume)),
  };
}
