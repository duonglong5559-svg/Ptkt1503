import { Candle } from "../types";

const BINANCE_VISION = "https://data-api.binance.vision/api/v3";
const BINANCE_FAPI = "https://fapi.binance.com/fapi/v1";
const OKX_API = "https://www.okx.com/api/v5";

const OKX_WS = "wss://ws.okx.com:8443/ws/v5/public";

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

const TF_TO_OKX: Record<string, string> = {
  "1m": "1m", "3m": "3m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1H", "2h": "2H", "4h": "4H", "6h": "6H", "8h": "8H",
  "12h": "12H", "1d": "1D", "1w": "1W",
};

const OKX_TF_REVERSE: Record<string, string> = {};
for (const [k, v] of Object.entries(TF_TO_OKX)) OKX_TF_REVERSE[v] = k;

function toOkxInstId(symbol: string): string {
  const map: Record<string, string> = {
    BTCUSDT: "BTC-USDT-SWAP",
    ETHUSDT: "ETH-USDT-SWAP",
    SOLUSDT: "SOL-USDT-SWAP",
    BNBUSDT: "BNB-USDT-SWAP",
    XAUUSDT: "XAU-USD",
  };
  return map[symbol.toUpperCase()] || symbol.replace("USDT", "-USDT-SWAP");
}

export class BrowserFeed {
  private ws: WebSocket | null = null;
  private reconnectTimer: any = null;
  private reconnectAttempts = 0;
  private onCandle?: BrowserCandleHandler;
  private currentSymbol = "";
  private currentTfs: string[] = [];
  private provider: "binance" | "okx" = "binance";

  async fetchKlines(symbol: string, interval: string, limit = 200): Promise<Candle[]> {
    try {
      return await this.fetchBinanceVision(symbol, interval, limit);
    } catch (e1) {
      console.warn(`[Feed] Binance Vision failed for ${symbol}/${interval}, trying Binance Futures...`);
      try {
        return await this.fetchBinanceFutures(symbol, interval, limit);
      } catch (e2) {
        console.warn(`[Feed] Binance Futures failed, trying OKX...`);
        return await this.fetchOKX(symbol, interval, limit);
      }
    }
  }

  async fetchPrice(symbol: string): Promise<number> {
    try {
      const res = await fetch(`${BINANCE_VISION}/ticker/price?symbol=${symbol.toUpperCase()}`);
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      return parseFloat(data.price);
    } catch {
      try {
        const res = await fetch(`${BINANCE_FAPI}/ticker/price?symbol=${symbol.toUpperCase()}`);
        if (!res.ok) throw new Error(`${res.status}`);
        const data = await res.json();
        return parseFloat(data.price);
      } catch {
        const instId = toOkxInstId(symbol);
        const res = await fetch(`${OKX_API}/market/ticker?instId=${instId}`);
        if (!res.ok) throw new Error(`OKX ${res.status}`);
        const data = await res.json();
        if (data.data && data.data[0]) return parseFloat(data.data[0].last);
        throw new Error("No OKX price data");
      }
    }
  }

  subscribe(symbol: string, timeframes: string[], onCandle: BrowserCandleHandler): void {
    this.onCandle = onCandle;
    this.currentSymbol = symbol;
    this.currentTfs = timeframes;

    this.tryBinanceWS(symbol, timeframes)
      .catch(() => {
        console.log("[Feed] Binance WS failed, using OKX WS");
        this.provider = "okx";
        this.connectOKX(symbol, timeframes);
      });
  }

  close(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async fetchBinanceVision(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const url = `${BINANCE_VISION}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance Vision ${res.status}`);
    const data: KlineRaw[] = await res.json();
    return data.map((k) => this.parseBinanceKline(symbol, interval, k));
  }

  private async fetchBinanceFutures(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const url = `${BINANCE_FAPI}/klines?symbol=${symbol.toUpperCase()}&interval=${interval}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Binance Futures ${res.status}`);
    const data: KlineRaw[] = await res.json();
    return data.map((k) => this.parseBinanceKline(symbol, interval, k));
  }

  private async fetchOKX(symbol: string, interval: string, limit: number): Promise<Candle[]> {
    const instId = toOkxInstId(symbol);
    const bar = TF_TO_OKX[interval] || interval;
    const url = `${OKX_API}/market/candles?instId=${instId}&bar=${bar}&limit=${Math.min(limit, 300)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OKX ${res.status}`);
    const data = await res.json();
    if (!data.data) throw new Error("No OKX data");

    return data.data
      .map((k: string[]) => ({
        symbol: symbol.toUpperCase(),
        timeframe: interval,
        openTime: parseInt(k[0]),
        closeTime: parseInt(k[0]) + this.tfToMs(interval),
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5]),
        isClosed: k[8] === "1",
      } as Candle))
      .reverse();
  }

  private parseBinanceKline(symbol: string, interval: string, k: KlineRaw): Candle {
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

  private tryBinanceWS(symbol: string, timeframes: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      const streams = timeframes.map((tf) => `${symbol.toLowerCase()}@kline_${tf}`);
      const urls = [
        `wss://fstream.binance.com/stream?streams=${streams.join("/")}`,
        `wss://stream.binance.com:9443/stream?streams=${streams.join("/")}`,
      ];

      let tried = 0;
      const tryNext = () => {
        if (tried >= urls.length) {
          reject(new Error("All Binance WS failed"));
          return;
        }
        const url = urls[tried++];
        const ws = new WebSocket(url);
        const timeout = setTimeout(() => {
          ws.close();
          tryNext();
        }, 5000);

        ws.onopen = () => {
          clearTimeout(timeout);
          this.ws = ws;
          this.provider = "binance";
          this.setupBinanceWS(ws);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          ws.close();
          tryNext();
        };
      };
      tryNext();
    });
  }

  private setupBinanceWS(ws: WebSocket): void {
    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        const d = msg.data || msg;
        if (!d || d.e !== "kline") return;
        const k = d.k;
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
    ws.onclose = () => this.handleReconnect();
  }

  private connectOKX(symbol: string, timeframes: string[]): void {
    if (this.ws) { this.ws.close(); this.ws = null; }
    const ws = new WebSocket(OKX_WS);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      const instId = toOkxInstId(symbol);
      const args = timeframes.map((tf) => ({
        channel: "candle" + (TF_TO_OKX[tf] || tf),
        instId,
      }));
      ws.send(JSON.stringify({ op: "subscribe", args }));
    };

    ws.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data);
        if (!msg.data || !msg.arg) return;
        const channel: string = msg.arg.channel || "";
        const barMatch = channel.replace("candle", "");
        const tf = OKX_TF_REVERSE[barMatch] || barMatch.toLowerCase();

        for (const k of msg.data) {
          const candle: Candle = {
            symbol: symbol.toUpperCase(),
            timeframe: tf,
            openTime: parseInt(k[0]),
            closeTime: parseInt(k[0]) + this.tfToMs(tf),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5]),
            isClosed: k[8] === "1",
          };
          this.onCandle?.(symbol.toUpperCase(), tf, candle, candle.isClosed);
        }
      } catch (_) {}
    };

    ws.onclose = () => this.handleReconnect();
    ws.onerror = () => {};
  }

  private handleReconnect(): void {
    if (this.reconnectAttempts >= 8) return;
    this.reconnectAttempts++;
    const delay = Math.min(2000 * Math.pow(2, this.reconnectAttempts), 30000);
    this.reconnectTimer = setTimeout(() => {
      if (this.provider === "okx") {
        this.connectOKX(this.currentSymbol, this.currentTfs);
      } else {
        this.tryBinanceWS(this.currentSymbol, this.currentTfs).catch(() => {
          this.provider = "okx";
          this.connectOKX(this.currentSymbol, this.currentTfs);
        });
      }
    }, delay);
  }

  private tfToMs(tf: string): number {
    const map: Record<string, number> = {
      "1m": 60000, "3m": 180000, "5m": 300000, "15m": 900000, "30m": 1800000,
      "1h": 3600000, "2h": 7200000, "4h": 14400000, "6h": 21600000,
      "8h": 28800000, "12h": 43200000, "1d": 86400000, "1w": 604800000,
    };
    return map[tf] || 3600000;
  }
}
