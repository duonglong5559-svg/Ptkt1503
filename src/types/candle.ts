export type Candle = {
  symbol: string;
  timeframe: string;
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
};

export type CandleMetrics = {
  body: number;
  range: number;
  upperWick: number;
  lowerWick: number;
  bodyRatio: number;
  upperRatio: number;
  lowerRatio: number;
  isBull: boolean;
  isBear: boolean;
  midpoint: number;
};

export function computeCandleMetrics(c: Candle): CandleMetrics {
  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;

  const safeRange = range === 0 ? 1e-10 : range;

  return {
    body,
    range,
    upperWick,
    lowerWick,
    bodyRatio: body / safeRange,
    upperRatio: upperWick / safeRange,
    lowerRatio: lowerWick / safeRange,
    isBull: c.close > c.open,
    isBear: c.close < c.open,
    midpoint: (c.high + c.low) / 2,
  };
}
