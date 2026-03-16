import { Candle, computeCandleMetrics, PivotRelation, TrendlineEngineOutput } from "../types";
import { CandleConfirmationContext, EMAContext, VolumeContext } from "../types/scoring";

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

export function computeCandleConfirmationContext(
  candles: Candle[],
  options: {
    atr?: number;
    structureState: string;
    pivotRelation: PivotRelation;
    trendlineOutput: TrendlineEngineOutput;
    emaContext?: EMAContext;
    nearestSupport?: number;
    nearestResistance?: number;
  }
): CandleConfirmationContext {
  const closed = getClosedCandles(candles);
  const last = closed[closed.length - 1];
  const previous = closed[closed.length - 2];

  if (!last || !previous) {
    return {
      bullishBreakoutConfirmed: false,
      bearishBreakdownConfirmed: false,
      bullishRetestConfirmed: false,
      bearishRetestConfirmed: false,
      lastCandleDirection: "neutral",
      bodyStrength: 0,
      closeLocation: 0.5,
      summary: "Chưa đủ nến đóng để xác nhận.",
    };
  }

  const metrics = computeCandleMetrics(last);
  const atr = options.atr || Math.max((last.high - last.low) * 0.8, last.close * 0.003);
  const candleDirection =
    last.close > last.open ? "bullish" : last.close < last.open ? "bearish" : "neutral";
  const closeLocation = metrics.range > 0 ? (last.close - last.low) / metrics.range : 0.5;
  const bodyStrength = Math.round(metrics.bodyRatio * 100);
  const tolerance = Math.max(atr * 0.18, last.close * 0.0012);

  const supportCandidates = [
    options.nearestSupport,
    options.pivotRelation.levels.s1,
    options.pivotRelation.levels.pivot < last.close ? options.pivotRelation.levels.pivot : undefined,
    options.trendlineOutput.primarySupport?.projectedPriceNow,
    options.emaContext?.ema20,
    options.emaContext?.ema50,
  ].filter((value): value is number => value !== undefined && value <= last.close + tolerance);

  const resistanceCandidates = [
    options.nearestResistance,
    options.pivotRelation.levels.r1,
    options.pivotRelation.levels.pivot > last.close ? options.pivotRelation.levels.pivot : undefined,
    options.trendlineOutput.primaryResistance?.projectedPriceNow,
    options.emaContext?.ema20,
    options.emaContext?.ema50,
  ].filter((value): value is number => value !== undefined && value >= last.close - tolerance);

  const supportLevel = supportCandidates.length > 0
    ? supportCandidates.reduce((best, value) => (last.close - value < last.close - best ? value : best))
    : undefined;
  const resistanceLevel = resistanceCandidates.length > 0
    ? resistanceCandidates.reduce((best, value) => (value - last.close < best - last.close ? value : best))
    : undefined;

  const bullishBreakoutConfirmed =
    candleDirection === "bullish" &&
    metrics.bodyRatio >= 0.45 &&
    closeLocation >= 0.68 &&
    (
      (resistanceLevel !== undefined && previous.close <= resistanceLevel + tolerance * 0.2 && last.close > resistanceLevel + tolerance * 0.35) ||
      (options.structureState === "breakout" && last.close > previous.high + tolerance * 0.15)
    );

  const bearishBreakdownConfirmed =
    candleDirection === "bearish" &&
    metrics.bodyRatio >= 0.45 &&
    closeLocation <= 0.32 &&
    (
      (supportLevel !== undefined && previous.close >= supportLevel - tolerance * 0.2 && last.close < supportLevel - tolerance * 0.35) ||
      (options.structureState === "breakdown" && last.close < previous.low - tolerance * 0.15)
    );

  const bullishRetestConfirmed =
    candleDirection === "bullish" &&
    metrics.bodyRatio >= 0.28 &&
    closeLocation >= 0.55 &&
    supportLevel !== undefined &&
    last.low <= supportLevel + tolerance &&
    last.close >= supportLevel;

  const bearishRetestConfirmed =
    candleDirection === "bearish" &&
    metrics.bodyRatio >= 0.28 &&
    closeLocation <= 0.45 &&
    resistanceLevel !== undefined &&
    last.high >= resistanceLevel - tolerance &&
    last.close <= resistanceLevel;

  const summaryParts: string[] = [];
  if (bullishBreakoutConfirmed) summaryParts.push("Breakout Long được nến đóng xác nhận");
  if (bearishBreakdownConfirmed) summaryParts.push("Breakdown Short được nến đóng xác nhận");
  if (bullishRetestConfirmed) summaryParts.push("Retest Long giữ hỗ trợ");
  if (bearishRetestConfirmed) summaryParts.push("Retest Short bị từ chối ở kháng cự");
  if (summaryParts.length === 0) summaryParts.push("Nến đóng gần nhất chưa xác nhận rõ breakout/retest");

  return {
    bullishBreakoutConfirmed,
    bearishBreakdownConfirmed,
    bullishRetestConfirmed,
    bearishRetestConfirmed,
    lastCandleDirection: candleDirection,
    bodyStrength,
    closeLocation: Math.round(closeLocation * 100) / 100,
    summary: summaryParts.join(". "),
  };
}
