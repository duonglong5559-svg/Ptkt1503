import axios from "axios";
import WebSocket from "ws";
import { Candle } from "../types";

const BASE_URL = "https://fapi.binance.com";
const WS_URL = "wss://fstream.binance.com/ws";

type KlineRaw = [
  number, // openTime
  string, // open
  string, // high
  string, // low
  string, // close
  string, // volume
  number, // closeTime
  string, // quoteAssetVolume
  number, // numberOfTrades
  string, // takerBuyBaseAssetVolume
  string, // takerBuyQuoteAssetVolume
  string, // ignore
];

type WsKlineEvent = {
  e: string;
  E: number;
  s: string;
  k: {
    t: number;
    T: number;
    s: string;
    i: string;
    f: number;
    L: number;
    o: string;
    c: string;
    h: string;
    l: string;
    v: string;
    n: number;
    x: boolean;
    q: string;
    V: string;
    Q: string;
    B: string;
  };
};

export type CandleUpdateHandler = (
  symbol: string,
  timeframe: string,
  candle: Candle,
  isClose: boolean
) => void;

export type PriceUpdateHandler = (symbol: string, price: number) => void;

export class BinanceFeed {
  private ws: WebSocket | null = null;
  private onCandleUpdate?: CandleUpdateHandler;
  private onPriceUpdate?: PriceUpdateHandler;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  async fetchKlines(
    symbol: string,
    interval: string,
    limit: number = 200
  ): Promise<Candle[]> {
    const url = `${BASE_URL}/fapi/v1/klines`;
    const response = await axios.get<KlineRaw[]>(url, {
      params: { symbol: symbol.toUpperCase(), interval, limit },
    });

    return response.data.map((k) => this.parseKline(symbol, interval, k));
  }

  async fetchPrice(symbol: string): Promise<number> {
    const url = `${BASE_URL}/fapi/v1/ticker/price`;
    const response = await axios.get<{ symbol: string; price: string }>(url, {
      params: { symbol: symbol.toUpperCase() },
    });
    return parseFloat(response.data.price);
  }

  subscribeKlines(
    symbol: string,
    timeframes: string[],
    onCandle: CandleUpdateHandler,
    onPrice?: PriceUpdateHandler
  ): void {
    this.onCandleUpdate = onCandle;
    this.onPriceUpdate = onPrice;

    const streams = timeframes.map(
      (tf) => `${symbol.toLowerCase()}@kline_${this.toWsInterval(tf)}`
    );
    const streamStr = streams.join("/");

    const wsUrl = `${WS_URL}/${streamStr}`;
    this.connect(wsUrl, symbol);
  }

  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private connect(url: string, symbol: string): void {
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log(`[BinanceFeed] WebSocket connected for ${symbol}`);
      this.reconnectAttempts = 0;
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      try {
        const event = JSON.parse(data.toString()) as WsKlineEvent;
        if (event.e !== "kline") return;

        const k = event.k;
        const tf = this.fromWsInterval(k.i);
        const candle: Candle = {
          symbol: k.s,
          timeframe: tf,
          openTime: k.t,
          closeTime: k.T,
          open: parseFloat(k.o),
          high: parseFloat(k.h),
          low: parseFloat(k.l),
          close: parseFloat(k.c),
          volume: parseFloat(k.v),
          isClosed: k.x,
        };

        this.onCandleUpdate?.(k.s, tf, candle, k.x);
        this.onPriceUpdate?.(k.s, candle.close);
      } catch (err) {
        console.error("[BinanceFeed] Parse error:", err);
      }
    });

    this.ws.on("close", () => {
      console.log("[BinanceFeed] WebSocket closed");
      this.tryReconnect(url, symbol);
    });

    this.ws.on("error", (err) => {
      console.error("[BinanceFeed] WebSocket error:", err.message);
    });
  }

  private tryReconnect(url: string, symbol: string): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("[BinanceFeed] Max reconnect attempts reached");
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
    console.log(
      `[BinanceFeed] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`
    );
    setTimeout(() => this.connect(url, symbol), delay);
  }

  private parseKline(symbol: string, interval: string, k: KlineRaw): Candle {
    return {
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
    };
  }

  private toWsInterval(tf: string): string {
    const map: Record<string, string> = {
      "15m": "15m",
      "1h": "1h",
      "2h": "2h",
      "4h": "4h",
      "6h": "6h",
      "8h": "8h",
      "12h": "12h",
      "1d": "1d",
      "1w": "1w",
    };
    return map[tf] || tf;
  }

  private fromWsInterval(interval: string): string {
    return interval;
  }
}
