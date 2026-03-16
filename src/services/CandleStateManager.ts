import { Candle } from "../types";

export type CandleCloseCallback = (timeframe: string, candle: Candle) => void;

export class CandleStateManager {
  private formingCandles: Map<string, Candle> = new Map();
  private onCandleClose?: CandleCloseCallback;

  setOnCandleClose(cb: CandleCloseCallback): void {
    this.onCandleClose = cb;
  }

  update(timeframe: string, candle: Candle): { closed: boolean; closedCandle?: Candle } {
    const key = `${candle.symbol}:${timeframe}`;
    const existing = this.formingCandles.get(key);

    if (candle.isClosed) {
      this.formingCandles.delete(key);
      this.onCandleClose?.(timeframe, candle);
      return { closed: true, closedCandle: candle };
    }

    if (existing && existing.openTime !== candle.openTime) {
      const closedPrev: Candle = { ...existing, isClosed: true };
      this.formingCandles.set(key, candle);
      this.onCandleClose?.(timeframe, closedPrev);
      return { closed: true, closedCandle: closedPrev };
    }

    this.formingCandles.set(key, candle);
    return { closed: false };
  }

  getForming(symbol: string, timeframe: string): Candle | undefined {
    return this.formingCandles.get(`${symbol}:${timeframe}`);
  }

  getAllForming(): Map<string, Candle> {
    return new Map(this.formingCandles);
  }
}
