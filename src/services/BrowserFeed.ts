import { Candle } from "../types";

const BASE_URL = "https://fapi.binance.com";
const WS_BASE = "wss://fstream.binance.com/stream?streams=";

type KlineRaw = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

export type BrowserCandleHandler = (
  symbol: string,
  timeframe: string,
  candle: Candle,
  isClose: boolean
) => void;

export class BrowserFeed {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private streamUrl = "";
  private onCandle?: BrowserCandleHandler;

  async fetchKlines(symbol: string, interval: string, limit = 200): Promise<Candle[]> {
    const url = `${BASE_URL}/fapi/v1/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Klines fetch failed: ${res.status}`);
    const data: KlineRaw[] = await res.json();
    return data.map((k) => ({
      symbol: symbol.toUpperCase(),
      timeframe: interval,
      openTime: k[0],
      closeTime: k[6],
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
      isClosed: true,
    }));
  }

  async fetchPrice(symbol: string): Promise<number> {
    const url = `${BASE_URL}/fapi/v1/ticker/price?symbol=${symbol.toUpperCase()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Price fetch failed: ${res.status}`);
    const data = await res.json();
    return parseFloat(data.price);
  }

  subscribe(symbol: string, timeframes: string[], onCandle: BrowserCandleHandler): void {
    this.onCandle = onCandle;
    const streams = timeframes.map((tf) => `${symbol.toLowerCase()}@kline_${tf}`);
    this.streamUrl = WS_BASE + streams.join("/");
    this.connect();
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.ws = new WebSocket(this.streamUrl);

    this.ws.onopen = () => {
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const data = msg.data;
        if (!data || data.e !== "kline") return;

        const k = data.k;
        const candle: Candle = {
          symbol: k.s,
          timeframe: k.i,
          openTime: k.t,
          closeTime: k.T,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        };

        this.onCandle?.(k.s, k.i, candle, k.x);
      } catch (_) {}
    };

    this.ws.onclose = () => {
      this.tryReconnect();
    };

    this.ws.onerror = () => {};
  }

  private tryReconnect(): void {
    if (this.reconnectAttempts >= 10) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }
}
