import { Candle } from "../types";

export function computeATR(candles: Candle[], period: number = 14): number {
  const closed = candles.filter((c) => c.isClosed);
  if (closed.length < period + 1) return 0;

  const trueRanges: number[] = [];
  for (let i = 1; i < closed.length; i++) {
    const high = closed[i].high;
    const low = closed[i].low;
    const prevClose = closed[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return 0;

  let atr = trueRanges.slice(0, period).reduce((s, v) => s + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }

  return Math.round(atr * 100) / 100;
}

export function computeVolatilityScore(atr: number, currentPrice: number): number {
  if (currentPrice === 0) return 50;
  const atrPercent = (atr / currentPrice) * 100;

  if (atrPercent < 0.3) return 20;
  if (atrPercent < 0.8) return 40;
  if (atrPercent < 1.5) return 60;
  if (atrPercent < 3.0) return 80;
  return 95;
}

export function computeMomentumScore(candles: Candle[], period: number = 10): number {
  const closed = candles.filter((c) => c.isClosed);
  if (closed.length < period + 1) return 50;

  const recent = closed.slice(-period);
  let bullCount = 0;
  let bearCount = 0;
  let sumChange = 0;

  for (let i = 1; i < recent.length; i++) {
    const change = recent[i].close - recent[i - 1].close;
    sumChange += change;
    if (change > 0) bullCount++;
    else if (change < 0) bearCount++;
  }

  const directionRatio = (bullCount - bearCount) / (period - 1);
  const score = 50 + directionRatio * 40;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export function detectMomentumDirection(candles: Candle[], period: number = 5): "rising" | "falling" | "flat" {
  const closed = candles.filter((c) => c.isClosed);
  if (closed.length < period + 1) return "flat";

  const recent = closed.slice(-(period + 1));
  const change = recent[recent.length - 1].close - recent[0].close;
  const avgRange = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;

  if (avgRange === 0) return "flat";
  const ratio = change / avgRange;

  if (ratio > 0.3) return "rising";
  if (ratio < -0.3) return "falling";
  return "flat";
}
