import "./styles.css";
import {
  createChart, IChartApi, ISeriesApi, UTCTimestamp, LineStyle,
  CandlestickData, LineData, CandlestickSeries, LineSeries,
  SeriesMarker, createSeriesMarkers, ISeriesMarkersPluginApi,
} from "lightweight-charts";
import { Pipeline, TimeframeAnalysisResult } from "./services/Pipeline";
import { BrowserFeed } from "./services/BrowserFeed";
import { CandleStateManager } from "./services/CandleStateManager";
import { FeedHealthService } from "./services/FeedHealthService";
import { NewsService } from "./services/NewsService";
import { SymbolMapping } from "./services/SymbolMapping";
import { Candle, UIPayload, PatternSignal, Trendline, TradingSignal, AppPhase, computeAppPhase } from "./types";
import { ANALYSIS_TIMEFRAMES } from "./types/symbol";

const TIMEFRAMES = [...ANALYSIS_TIMEFRAMES];
const CANDLE_LIMIT = 150;
const LIVE_ANALYSIS_THROTTLE_MS = 1200;

let currentSymbol = "BTCUSDT";
let selectedTf = "1h";
let pipeline: Pipeline;
let feed: BrowserFeed;
let candleManager: CandleStateManager;
let healthService: FeedHealthService;
let newsService: NewsService;
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let markersPlugin: ISeriesMarkersPluginApi<any> | null = null;
let trendlineSeriesList: ISeriesApi<"Line">[] = [];
let priceLines: any[] = [];
let lastPayload: UIPayload | null = null;
let currentPrice = 0;
let chartCandleCache: Candle[] = [];
let lastLiveAnalysisAt = 0;
let currentNewsFilter: "all" | "BTC" | "ETH" | "PAXG" = "all";

type TrendlineListItem = {
  timeframe: string;
  trendline: Trendline;
};

type SetupCardModel = {
  tone: "long" | "short";
  title: string;
  anchorLabel: string;
  anchorPrice?: number;
  confidence: number;
  confidenceText: string;
  subtitle: string;
  tags: string[];
  entry?: number;
  scalp?: number;
  swing?: number;
  stopLoss?: number;
  statusText: string;
  summaryText: string;
};

type ChartCalloutModel = {
  tone: "long" | "short" | "target" | "plan";
  label: string;
  price: number;
  top: number;
};

// ── Bootstrap ───────────────────────────────────────────────
async function init() {
  log("App starting");
  newsService = new NewsService();
  setupTabs();
  setupSymbolSelector();
  setupChart();
  await loadSymbol(currentSymbol);
}

async function loadSymbol(symbol: string) {
  showLoading(true, "Đang kết nối...");
  healthService = new FeedHealthService();

  try {
    currentSymbol = symbol;

    if (feed) feed.close();
    feed = new BrowserFeed();
    pipeline = new Pipeline(symbol);
    candleManager = new CandleStateManager();
    chartCandleCache = [];
    lastLiveAnalysisAt = 0;

    healthService.setRestWarmup("loading");
    updateHealthIndicator();
    showLoading(true, "Đang tải dữ liệu nến...");

    const results = await Promise.allSettled(
      TIMEFRAMES.map(async (tf) => {
        const candles = await feed.fetchKlines(symbol, tf, CANDLE_LIMIT);
        return { tf, candles };
      })
    );

    let loaded = 0;
    for (const r of results) {
      if (r.status === "fulfilled" && r.value.candles.length > 0) {
        pipeline.initializeCache(r.value.tf, r.value.candles);
        healthService.recordTimeframeCandleClose(r.value.tf, r.value.candles.length);
        loaded++;
        if (r.value.tf === selectedTf) {
          chartCandleCache = r.value.candles;
        }
      } else if (r.status === "rejected") {
        log(`TF fetch failed: ${r.reason}`);
      }
    }

    if (chartCandleCache.length === 0) {
      for (const r of results) {
        if (r.status === "fulfilled" && r.value.candles.length > 0) {
          chartCandleCache = r.value.candles;
          selectedTf = r.value.tf;
          break;
        }
      }
    }

    log(`Loaded ${loaded}/${TIMEFRAMES.length} timeframes`);

    if (loaded === 0) {
      healthService.setRestWarmup("error", "Không thể tải dữ liệu từ Binance.");
      pipeline.setFeedHealth(healthService.getHealth());
      showError("Không thể tải dữ liệu. Feed không khả dụng.", true);
      return;
    }

    healthService.setRestWarmup("ok");

    const lastCandlePrice = chartCandleCache[chartCandleCache.length - 1]?.close || 0;
    try {
      const fetchedPrice = await feed.fetchPrice(symbol);
      if (lastCandlePrice > 0 && Math.abs(fetchedPrice - lastCandlePrice) / lastCandlePrice > 0.5) {
        log(`Price mismatch: fetched ${fetchedPrice} vs candle ${lastCandlePrice}, using candle price`);
        currentPrice = lastCandlePrice;
      } else {
        currentPrice = fetchedPrice;
      }
      healthService.recordPriceUpdate();
    } catch {
      currentPrice = lastCandlePrice;
    }

    showLoading(true, "Đang vẽ biểu đồ...");
    await yieldToUI();

    try {
      renderChartData();
      updatePriceTag(currentPrice);
    } catch (e: any) {
      log("Chart render error: " + e.message);
    }

    showLoading(true, "Đang phân tích...");
    await yieldToUI();

    pipeline.setFeedHealth(healthService.getHealth());

    try {
      const news = await newsService.fetchNews();
      pipeline.setNews(news);
    } catch {}

    try {
      const payload = pipeline.runFullAnalysis(currentPrice);
      healthService.recordFullAnalysis();
      lastPayload = payload;
      updateUI(payload);
      updateChartAnnotations(payload);
    } catch (e: any) {
      log("Analysis error: " + e.message);
    }

    hideError();
    startStream();
  } catch (e: any) {
    log("Fatal loadSymbol error: " + e.message);
    healthService.setRestWarmup("error", e.message);
    showError("Lỗi tải dữ liệu: " + (e.message || "Không rõ") + ". Nhấn nút để thử lại.", true);
  } finally {
    showLoading(false);
    updateHealthIndicator();
  }
}

function yieldToUI(): Promise<void> {
  return new Promise((r) => setTimeout(r, 10));
}

// ── Chart ───────────────────────────────────────────────────
function setupChart() {
  const container = document.getElementById("chart-container")!;
  container.innerHTML = "";
  trendlineSeriesList = [];
  priceLines = [];

  const rect = container.getBoundingClientRect();
  const w = rect.width || window.innerWidth;
  const h = rect.height || window.innerHeight * 0.45;

  chart = createChart(container, {
    width: w,
    height: Math.max(h, 250),
    layout: { background: { color: "#0a0e17" } as any, textColor: "#9e9e9e", fontSize: 10 },
    grid: { vertLines: { color: "rgba(255,255,255,0.04)" }, horzLines: { color: "rgba(255,255,255,0.04)" } },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.1)", scaleMargins: { top: 0.1, bottom: 0.1 } },
    timeScale: { borderColor: "rgba(255,255,255,0.1)", timeVisible: true, secondsVisible: false },
    watermark: { visible: true, text: "SC Crypto & Forex Trading", color: "rgba(255,255,255,0.04)", fontSize: 16 },
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
    wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  });
  markersPlugin = createSeriesMarkers(candleSeries);

  new ResizeObserver((entries) => {
    if (!chart) return;
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) {
      chart.resize(width, height);
      if (lastPayload) updateChartCallouts(lastPayload);
    }
  }).observe(container);
}

function renderChartData() {
  if (!candleSeries || chartCandleCache.length === 0) return;
  const closed = chartCandleCache.filter((c) => c.isClosed);
  if (closed.length === 0) return;
  const data: CandlestickData[] = closed.map((c) => ({
    time: (c.openTime / 1000) as UTCTimestamp,
    open: c.open, high: c.high, low: c.low, close: c.close,
  }));
  candleSeries.setData(data);
  chart?.timeScale().fitContent();
  log("Chart rendered: " + data.length + " candles");
}

function updateChartCandle(candle: Candle) {
  candleSeries?.update({
    time: (candle.openTime / 1000) as UTCTimestamp,
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
  });
}

function renderPatternMarkers(patterns: PatternSignal[], candles: Candle[]) {
  if (!markersPlugin) return;
  const closed = candles.filter((c) => c.isClosed);
  const nameMap: Record<string, string> = {
    doji: "Doji", hammer: "Hammer", inverted_hammer: "Inv Hammer",
    shooting_star: "Shoot Star", bullish_engulfing: "Bull Engulf",
    bearish_engulfing: "Bear Engulf", morning_star: "Morn Star",
    evening_star: "Eve Star", three_white_soldiers: "3WS", three_black_crows: "3BC",
  };
  const markers: SeriesMarker<UTCTimestamp>[] = [];
  for (const p of patterns) {
    if (p.candleIndex < 0 || p.candleIndex >= closed.length) continue;
    const c = closed[p.candleIndex];
    const bull = p.direction === "bullish";
    markers.push({
      time: (c.openTime / 1000) as UTCTimestamp,
      position: bull ? "belowBar" : "aboveBar",
      color: bull ? "#26a69a" : "#ef5350",
      shape: bull ? "arrowUp" : "arrowDown",
      text: nameMap[p.pattern] || p.pattern,
    });
  }
  markers.sort((a, b) => (a.time as number) - (b.time as number));
  markersPlugin.setMarkers(markers);
}

function renderEntryLines(signal: TradingSignal) {
  if (!candleSeries) return;
  for (const pl of priceLines) { try { candleSeries.removePriceLine(pl); } catch {} }
  priceLines = [];
  const add = (price: number | undefined, color: string, style: any, title: string) => {
    if (!price || !candleSeries) return;
    try { priceLines.push(candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })); } catch {}
  };
  if (signal.direction === "long") {
    add(signal.entryLong, "#26a69a", LineStyle.Dashed, `Buy ${signal.entryLong?.toFixed(2)}`);
  } else if (signal.direction === "short") {
    add(signal.entryShort, "#ef5350", LineStyle.Dashed, `Sell ${signal.entryShort?.toFixed(2)}`);
  } else {
    add(signal.entryLong, "rgba(38,166,154,0.85)", LineStyle.Dashed, `Long ${signal.entryLong?.toFixed(2)}`);
    add(signal.entryShort, "rgba(239,83,80,0.85)", LineStyle.Dashed, `Short ${signal.entryShort?.toFixed(2)}`);
  }
  add(signal.target, "#ffd700", LineStyle.Dotted, "Target");
  if (signal.direction !== "neutral") {
    add(signal.stopLoss, "#ff6d00", LineStyle.Dotted, "SL");
  }
}

function getTrendlineStyle(tl: Trendline): { color: string; width: number } {
  const isSup = tl.type.includes("support");
  const vs = tl.visualState;

  if (vs === "hot") return { color: isSup ? "rgba(0,255,200,0.95)" : "rgba(255,50,100,0.95)", width: 3 };
  if (vs === "near") return { color: isSup ? "rgba(0,200,160,0.75)" : "rgba(220,80,120,0.75)", width: 2 };
  if (vs === "break") return { color: isSup ? "rgba(255,120,50,0.85)" : "rgba(50,200,180,0.85)", width: 2 };
  if (vs === "retest") return { color: isSup ? "rgba(0,220,180,0.8)" : "rgba(220,60,100,0.8)", width: 2 };
  return { color: "rgba(150,150,150,0.4)", width: 1 };
}

function renderTrendlines(trendlines: Trendline[], candles: Candle[]) {
  if (!chart) return;
  for (const s of trendlineSeriesList) { try { chart.removeSeries(s); } catch {} }
  trendlineSeriesList = [];
  const closed = candles.filter((c) => c.isClosed);
  if (closed.length === 0 || trendlines.length === 0) return;

  for (const tl of trendlines.slice(0, 4)) {
    const { color, width } = getTrendlineStyle(tl);

    if (tl.points.x1 < 0 || tl.points.x2 < 0 || tl.points.x1 >= closed.length || tl.points.x2 >= closed.length) {
      continue;
    }
    const i1 = tl.points.x1;
    const i2 = tl.points.x2;
    if (i1 === i2) continue;

    const series = chart.addSeries(LineSeries, {
      color, lineWidth: width, lineStyle: tl.tier === "primary" ? LineStyle.Solid : LineStyle.Dashed,
      crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
    });

    const data: LineData[] = [
      { time: (closed[i1].openTime / 1000) as UTCTimestamp, value: tl.points.y1 },
      { time: (closed[i2].openTime / 1000) as UTCTimestamp, value: tl.points.y2 },
    ];

    const extIdx = closed.length - 1;
    if (extIdx > i2) {
      const extPrice = tl.slope * extIdx + tl.intercept;
      if (extPrice > 0) data.push({ time: (closed[extIdx].openTime / 1000) as UTCTimestamp, value: extPrice });
    }

    series.setData(data);
    trendlineSeriesList.push(series);
  }
}

// ── Streaming ───────────────────────────────────────────────
function startStream() {
  const streamSymbol = currentSymbol;

  candleManager = new CandleStateManager();
  candleManager.setOnCandleClose((tf, candle) => {
    if (streamSymbol !== currentSymbol) return;

    pipeline.updateCandle(tf, candle);
    if (tf === selectedTf) {
      chartCandleCache.push(candle);
      if (chartCandleCache.length > 500) chartCandleCache.splice(0, chartCandleCache.length - 500);
    }
    try {
      pipeline.setFeedHealth(healthService.getHealth());
      const payload = pipeline.runFullAnalysis(candle.close);
      healthService.recordFullAnalysis();
      lastPayload = payload;
      currentPrice = payload.currentPrice;
      updateUI(payload);
      if (tf === selectedTf) { renderChartData(); updateChartAnnotations(payload); }
    } catch {}
  });

  healthService.setWebSocket("connecting");
  updateHealthIndicator();

  feed.subscribe(streamSymbol, TIMEFRAMES, (sym, tf, candle, _isClose) => {
    if (streamSymbol !== currentSymbol) return;

    const candleSym = (candle.symbol || sym || "").toUpperCase();
    if (candleSym !== streamSymbol.toUpperCase()) return;

    const { closed } = candleManager.update(tf, candle);
    if (!closed) {
      pipeline.updateCandle(tf, candle);
      if (tf === selectedTf) updateChartCandle(candle);
      currentPrice = candle.close;
      healthService.recordPriceUpdate();
      updatePriceTag(candle.close);

      const now = Date.now();
      if (now - lastLiveAnalysisAt >= LIVE_ANALYSIS_THROTTLE_MS) {
        lastLiveAnalysisAt = now;
        try {
          pipeline.setFeedHealth(healthService.getHealth());
          const payload = pipeline.runTickUpdate(candle.close);
          if (payload) {
            lastPayload = payload;
            currentPrice = payload.currentPrice;
            updateUI(payload);
            updateChartAnnotations(payload);
          }
        } catch (e: any) {
          log("Tick analysis error: " + e.message);
        }
      }
    }

    if (healthService.getHealth().websocket !== "connected") {
      healthService.setWebSocket("connected");
      updateHealthIndicator();
    }
  });
}

// ── UI Updates ──────────────────────────────────────────────
function updateUI(payload: UIPayload) {
  updateBiasBar(payload.globalBias.long, payload.globalBias.short);
  updateSignalBadge(payload.signal.direction, payload.signal.state);
  updateTimeframeCards(payload);
  updateMarquee(payload.signal.summary);
  updateSignalOverlay(payload);
  updateSignalSnapshot(payload);
  updateSignalSteps();
  updateConfidence();
  updatePriceTag(payload.currentPrice);
  updateTrendlineTab(payload);
  updateHealthIndicator();
}

function updateBiasBar(l: number, s: number) {
  document.getElementById("long-pct")!.textContent = `${l}%`;
  document.getElementById("short-pct")!.textContent = `${s}%`;
  document.getElementById("long-fill")!.style.width = `${l}%`;
  document.getElementById("short-fill")!.style.width = `${s}%`;
}

function getSignalBadgeConfig(dir: string, state: string): { text: string; className: string } {
  if (state === "cooldown") return { text: "Chờ Cooldown", className: "badge badge-neutral" };
  if (state === "active_long") return { text: "Đang Long", className: "badge badge-long" };
  if (state === "active_short") return { text: "Đang Short", className: "badge badge-short" };
  if (state === "triggered_long") return { text: "Vào Lệnh Long", className: "badge badge-long" };
  if (state === "triggered_short") return { text: "Vào Lệnh Short", className: "badge badge-short" };
  if (state === "ready_long") return { text: "Lệnh Chờ Long", className: "badge badge-long" };
  if (state === "ready_short") return { text: "Lệnh Chờ Short", className: "badge badge-short" };
  if (state === "watch_long") return { text: "Theo dõi Long", className: "badge badge-long" };
  if (state === "watch_short") return { text: "Theo dõi Short", className: "badge badge-short" };
  if (dir === "long") return { text: "Theo dõi Long", className: "badge badge-long" };
  if (dir === "short") return { text: "Theo dõi Short", className: "badge badge-short" };
  return { text: "Theo dõi", className: "badge badge-neutral" };
}

function updateSignalBadge(dir: string, state: string) {
  const b = document.getElementById("signal-badge")!;
  const badge = getSignalBadgeConfig(dir, state);
  b.textContent = badge.text;
  b.className = badge.className;
}

function updateTimeframeCards(payload: UIPayload) {
  const row = document.getElementById("tf-row")!;
  row.innerHTML = "";
  for (const tf of TIMEFRAMES) {
    const d = payload.timeframes[tf];
    const card = document.createElement("div");
    if (d) {
      const bias = d.bias || "neutral";
      card.className = `tf-card${tf === selectedTf ? " active" : ""}${bias === "bullish" ? " bullish" : bias === "bearish" ? " bearish" : ""}`;
      const topValue = `${Math.max(d.long, d.short)}%`;
      const bottomValue = `${Math.min(d.long, d.short)}%`;
      card.innerHTML = `
        <span class="tf-top-value">${topValue}</span>
        <span class="tf-label">${tf.toUpperCase()}</span>
        <span class="tf-bottom-value">${bottomValue}</span>
      `;
    } else {
      card.className = `tf-card${tf === selectedTf ? " active" : ""}`;
      card.innerHTML = `
        <span class="tf-top-value">---</span>
        <span class="tf-label">${tf.toUpperCase()}</span>
        <span class="tf-bottom-value">---</span>
      `;
    }
    card.onclick = () => switchTimeframe(tf);
    row.appendChild(card);
  }
}

function updateMarquee(text: string) {
  document.getElementById("marquee-text")!.textContent = text;
}

function getSelectedTimeframeResult(): TimeframeAnalysisResult | undefined {
  return pipeline?.getState().timeframeResults.get(selectedTf) as TimeframeAnalysisResult | undefined;
}

function formatSignalPrice(price?: number): string {
  return price && price > 0 ? price.toFixed(2) : "---";
}

function formatDistanceFromPrice(price: number | undefined, referencePrice: number): string {
  if (!price || !referencePrice || referencePrice <= 0) return "Chờ dữ liệu";
  const deltaPct = ((price - referencePrice) / referencePrice) * 100;
  if (Math.abs(deltaPct) < 0.05) return "Sát giá hiện tại";
  const side = deltaPct > 0 ? "cao hơn" : "thấp hơn";
  return `${Math.abs(deltaPct).toFixed(2)}% ${side} hiện tại`;
}

function formatAtrDistance(price: number | undefined, referencePrice: number, atr?: number): string {
  if (!price || !referencePrice || !atr || atr <= 0) return "Chờ dữ liệu";
  const atrDistance = Math.abs(referencePrice - price) / atr;
  return `Cách giá ${atrDistance.toFixed(1)} ATR`;
}

function describeZoneDistance(
  tone: "long" | "short",
  price: number | undefined,
  currentMarketPrice: number,
  atr?: number
): string {
  if (!price || !currentMarketPrice || !atr || atr <= 0) return "Chờ dữ liệu vùng giá.";
  const atrDistance = Math.abs(currentMarketPrice - price) / atr;
  const area = tone === "long" ? "hỗ trợ" : "kháng cự";
  if (atrDistance <= 0.6) return `Giá đang rất gần ${area} (${atrDistance.toFixed(1)} ATR).`;
  if (atrDistance <= 1.3) return `Giá đang tiến gần ${area} (${atrDistance.toFixed(1)} ATR).`;
  return `Giá còn xa ${area} (${atrDistance.toFixed(1)} ATR).`;
}

function getConfidenceText(confidence: number): string {
  if (confidence >= 82) return "Rất mạnh";
  if (confidence >= 70) return "Mạnh";
  if (confidence >= 58) return "Khá tốt";
  return "Theo dõi";
}

function computeRiskRewardText(
  tone: "long" | "short",
  entry: number | undefined,
  stopLoss: number | undefined,
  target: number | undefined
): string {
  if (!entry || !stopLoss || !target) return "RR chưa rõ";
  const risk = Math.abs(entry - stopLoss);
  const reward = Math.abs(target - entry);
  if (risk <= 0) return "RR chưa rõ";
  return `RR 1:${(reward / risk).toFixed(1)}`;
}

function computeProjectedTargets(
  tone: "long" | "short",
  entry: number | undefined,
  signal: UIPayload["signal"],
  tf: TimeframeAnalysisResult | undefined
): { scalp?: number; swing?: number } {
  if (!entry || !tf) return {};

  const pivot = tf.pivotRelation.levels;
  if (tone === "long") {
    const scalpCandidates = [
      signal.target,
      signal.takeProfit,
      tf.pivotRelation.nearestResistance,
      pivot.pivot,
      pivot.r1,
    ].filter((value): value is number => value !== undefined && value > entry);
    const swingCandidates = [
      signal.target,
      signal.takeProfit,
      pivot.r1,
      pivot.r2,
      tf.trendlines.primaryResistance?.projectedPriceNow,
    ].filter((value): value is number => value !== undefined && value > entry);
    scalpCandidates.sort((a, b) => a - b);
    swingCandidates.sort((a, b) => a - b);
    return {
      scalp: scalpCandidates[0],
      swing: swingCandidates[Math.min(1, swingCandidates.length - 1)] || swingCandidates[0],
    };
  }

  const scalpCandidates = [
    signal.target,
    signal.takeProfit,
    tf.pivotRelation.nearestSupport,
    pivot.pivot,
    pivot.s1,
  ].filter((value): value is number => value !== undefined && value < entry);
  const swingCandidates = [
    signal.target,
    signal.takeProfit,
    pivot.s1,
    pivot.s2,
    tf.trendlines.primarySupport?.projectedPriceNow,
  ].filter((value): value is number => value !== undefined && value < entry);
  scalpCandidates.sort((a, b) => b - a);
  swingCandidates.sort((a, b) => b - a);
  return {
    scalp: scalpCandidates[0],
    swing: swingCandidates[Math.min(1, swingCandidates.length - 1)] || swingCandidates[0],
  };
}

function getDefaultStopLoss(
  tone: "long" | "short",
  anchorPrice: number | undefined,
  currentMarketPrice: number,
  atr?: number
): number | undefined {
  const basePrice = anchorPrice || currentMarketPrice;
  const effectiveAtr = atr || currentMarketPrice * 0.005;
  if (!basePrice || effectiveAtr <= 0) return undefined;
  const stop = tone === "long" ? basePrice - effectiveAtr * 0.8 : basePrice + effectiveAtr * 0.8;
  return Math.round(stop * 100) / 100;
}

function buildSetupCardModels(payload: UIPayload): SetupCardModel[] {
  const tf = getSelectedTimeframeResult();
  const atr = tf?.atr;
  const signal = payload.signal;
  const longAnchor = signal.entryLong || tf?.pivotRelation.nearestSupport || tf?.trendlines.primarySupport?.projectedPriceNow;
  const shortAnchor = signal.entryShort || tf?.pivotRelation.nearestResistance || tf?.trendlines.primaryResistance?.projectedPriceNow;
  const longTargets = computeProjectedTargets("long", longAnchor, signal, tf);
  const shortTargets = computeProjectedTargets("short", shortAnchor, signal, tf);

  return [
    {
      tone: "long",
      title: "HỖ TRỢ",
      anchorLabel: "Hỗ trợ gần",
      anchorPrice: longAnchor,
      confidence: signal.confidenceLong,
      confidenceText: getConfidenceText(signal.confidenceLong),
      subtitle: describeZoneDistance("long", longAnchor, payload.currentPrice, atr),
      tags: [signal.state.includes("long") ? "AUTO" : "PLAN", selectedTf.toUpperCase()],
      entry: signal.entryLong || longAnchor,
      scalp: longTargets.scalp,
      swing: longTargets.swing,
      stopLoss: signal.direction === "long"
        ? signal.stopLoss
        : getDefaultStopLoss("long", signal.entryLong || longAnchor, payload.currentPrice, atr),
      statusText: `${getConfidenceText(signal.confidenceLong)} · ${signal.confidenceLong}% tin cậy · ${computeRiskRewardText("long", signal.entryLong || longAnchor, signal.direction === "long" ? signal.stopLoss : getDefaultStopLoss("long", signal.entryLong || longAnchor, payload.currentPrice, atr), longTargets.swing || longTargets.scalp)}`,
      summaryText: payload.signal.direction === "long"
        ? "Giá đang vào vùng hỗ trợ ưu tiên cho kịch bản Long."
        : "Canh mua khi giá phản ứng tốt tại hỗ trợ.",
    },
    {
      tone: "short",
      title: "KHÁNG CỰ",
      anchorLabel: "Kháng cự gần",
      anchorPrice: shortAnchor,
      confidence: signal.confidenceShort,
      confidenceText: getConfidenceText(signal.confidenceShort),
      subtitle: describeZoneDistance("short", shortAnchor, payload.currentPrice, atr),
      tags: [signal.state.includes("short") ? "AUTO" : "PLAN", selectedTf.toUpperCase()],
      entry: signal.entryShort || shortAnchor,
      scalp: shortTargets.scalp,
      swing: shortTargets.swing,
      stopLoss: signal.direction === "short"
        ? signal.stopLoss
        : getDefaultStopLoss("short", signal.entryShort || shortAnchor, payload.currentPrice, atr),
      statusText: `${getConfidenceText(signal.confidenceShort)} · ${signal.confidenceShort}% tin cậy · ${computeRiskRewardText("short", signal.entryShort || shortAnchor, signal.direction === "short" ? signal.stopLoss : getDefaultStopLoss("short", signal.entryShort || shortAnchor, payload.currentPrice, atr), shortTargets.swing || shortTargets.scalp)}`,
      summaryText: payload.signal.direction === "short"
        ? "Giá đang vào vùng kháng cự ưu tiên cho kịch bản Short."
        : "Canh bán khi giá bị từ chối tại kháng cự.",
    },
  ];
}

function renderSetupCard(card: SetupCardModel): string {
  return `
    <div class="signal-card ${card.tone}">
      <div class="signal-card-header">
        <div>
          <div class="signal-card-title">${card.title} @ ${formatSignalPrice(card.anchorPrice)}</div>
          <div class="signal-card-subtitle">${card.anchorLabel} · ${card.subtitle}</div>
        </div>
        <div class="signal-card-tags">
          ${card.tags.map((tag, index) => `<span class="signal-tag ${index === card.tags.length - 1 ? card.tone : "neutral"}">${tag}</span>`).join("")}
        </div>
      </div>
      <div class="signal-card-strength ${card.tone}">${card.statusText}</div>
      <div class="signal-card-subtitle signal-card-note">${card.summaryText}</div>
      <div class="signal-price-list">
        <div class="signal-price-row">
          <span>Entry</span>
          <strong>${formatSignalPrice(card.entry)}</strong>
        </div>
        <div class="signal-price-row">
          <span>Scalp</span>
          <strong>${formatSignalPrice(card.scalp)}</strong>
        </div>
        <div class="signal-price-row">
          <span>Swing</span>
          <strong>${formatSignalPrice(card.swing)}</strong>
        </div>
        <div class="signal-price-row">
          <span>StopLoss</span>
          <strong>${formatSignalPrice(card.stopLoss)}</strong>
        </div>
      </div>
    </div>
  `;
}

function updateSignalOverlay(payload: UIPayload) {
  const el = document.getElementById("signal-overlay");
  if (!el) return;
  el.innerHTML = "";
}

function positionChartCallouts(callouts: ChartCalloutModel[], height: number): ChartCalloutModel[] {
  const minGap = 38;
  const minTop = 42;
  const maxTop = Math.max(minTop, height - 34);
  const sorted = [...callouts].sort((a, b) => a.top - b.top);

  for (const callout of sorted) {
    callout.top = Math.max(minTop, Math.min(callout.top, maxTop));
  }

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].top - sorted[i - 1].top < minGap) {
      sorted[i].top = sorted[i - 1].top + minGap;
    }
  }

  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].top > maxTop) {
      const overflow = sorted[i].top - maxTop;
      for (let j = 0; j <= i; j++) {
        sorted[j].top -= overflow;
      }
    }
    if (i < sorted.length - 1 && sorted[i + 1].top - sorted[i].top < minGap) {
      sorted[i].top = sorted[i + 1].top - minGap;
    }
  }

  for (const callout of sorted) {
    callout.top = Math.max(minTop, Math.min(callout.top, maxTop));
  }

  return sorted;
}

function updateChartCallouts(payload: UIPayload) {
  const el = document.getElementById("chart-callouts");
  const area = document.getElementById("chart-area");
  if (!el || !area || !candleSeries) return;

  const tf = getSelectedTimeframeResult();
  const targetPrice = payload.signal.target ?? payload.signal.takeProfit;
  const rawCallouts = [
    targetPrice ? { tone: "target" as const, label: "Giá thị trường sẽ hướng tới", price: targetPrice } : null,
    payload.signal.entryShort ? { tone: "short" as const, label: "Đặt lệnh chờ tự động Short", price: payload.signal.entryShort } : null,
    payload.signal.entryLong ? { tone: "long" as const, label: "Đặt lệnh chờ tự động Long", price: payload.signal.entryLong } : null,
    tf?.pivotRelation.levels.pivot ? { tone: "plan" as const, label: "Theo dõi phản ứng tại Pivot", price: tf.pivotRelation.levels.pivot } : null,
  ].filter((item): item is { tone: "long" | "short" | "target" | "plan"; label: string; price: number } => item !== null);

  const projected: ChartCalloutModel[] = [];
  for (const item of rawCallouts) {
    const coordinate = candleSeries.priceToCoordinate(item.price);
    if (coordinate === null) continue;
    projected.push({
      ...item,
      top: coordinate - 14,
    });
  }

  if (projected.length === 0) {
    el.innerHTML = "";
    return;
  }

  const positioned = positionChartCallouts(projected, area.clientHeight || 260);
  el.innerHTML = positioned
    .map((item) => `
      <div class="chart-callout ${item.tone}" style="top:${item.top.toFixed(0)}px">
        <span class="chart-callout-label">${item.label}</span>
        <strong class="chart-callout-price">${formatSignalPrice(item.price)}</strong>
      </div>
    `)
    .join("");
}

function updateSignalSnapshot(payload: UIPayload) {
  const c = document.getElementById("signal-snapshot")!;
  const signal = payload.signal;
  const badge = getSignalBadgeConfig(signal.direction, signal.state);
  const cards = buildSetupCardModels(payload);
  c.innerHTML = `
    <div class="signal-summary-card">
      <div class="signal-card-header">
        <div>
          <div class="signal-card-title">Tín hiệu hiện tại</div>
          <div class="signal-card-subtitle">${signal.summary}</div>
        </div>
        <div class="signal-card-tags">
          <span class="signal-tag ${signal.direction === "long" ? "long" : signal.direction === "short" ? "short" : "neutral"}">${badge.text}</span>
          <span class="signal-tag neutral">${selectedTf.toUpperCase()}</span>
        </div>
      </div>
      <div class="signal-summary-text">
        Bias hiện tại: Long ${signal.confidenceLong}% / Short ${signal.confidenceShort}%.
        Entry Long ${formatDistanceFromPrice(signal.entryLong, payload.currentPrice)}.
        Entry Short ${formatDistanceFromPrice(signal.entryShort, payload.currentPrice)}.
      </div>
    </div>
    <div class="setup-list">
      ${cards.map((card) => renderSetupCard(card)).join("")}
    </div>
  `;
}

function updateSignalSteps() {
  const c = document.getElementById("signal-steps")!;
  const s = pipeline?.getState().lastSignal;
  if (!s?.steps) {
    const phase = healthService ? healthService.getPhase() : "cold_start";
    const msg = phase === "live" ? "Đang phân tích..." : phase === "warmup" ? "Đang tải dữ liệu..." : "Chờ kết nối...";
    c.innerHTML = `<div class="step-card pending"><div class="step-num">?</div><div class="step-body"><div class="step-title">${msg}</div></div></div>`;
    return;
  }
  let html = s.steps.map((st) => `<div class="step-card ${st.status}"><div class="step-num">${st.step}</div><div class="step-body"><div class="step-title">${st.title}</div><div class="step-desc">${st.description}</div></div></div>`).join("");

  if (s.primaryScenario) {
    html += `<div class="step-card completed" style="border-color:var(--cyan);background:rgba(0,188,212,.08)"><div class="step-num">▸</div><div class="step-body"><div class="step-title">Kịch bản chính</div><div class="step-desc">${s.primaryScenario}</div></div></div>`;
  }
  if (s.alternativeScenario) {
    html += `<div class="step-card pending" style="border-color:var(--gold);background:rgba(255,215,0,.06)"><div class="step-num">▹</div><div class="step-body"><div class="step-title">Kịch bản phụ</div><div class="step-desc">${s.alternativeScenario}</div></div></div>`;
  }

  c.innerHTML = html;
}

function updateConfidence() {
  const el = document.getElementById("confidence-value")!;
  const sig = pipeline?.getState().lastSignal;
  if (!sig) {
    el.textContent = "---";
    el.style.color = "var(--text3)";
    return;
  }
  const c = sig.overallConfidence;
  el.textContent = `${c}%`;
  el.style.color = c >= 70 ? "var(--green)" : c >= 50 ? "var(--gold)" : "var(--red)";
}

function updatePriceTag(price: number) {
  if (!price || price <= 0) {
    document.getElementById("current-price-tag")!.textContent = "---";
    return;
  }
  if (currentPrice > 0 && Math.abs(price - currentPrice) / currentPrice > 0.5) {
    return;
  }
  document.getElementById("current-price-tag")!.textContent = price.toFixed(2);
}

function updateTrendlineTab(payload: UIPayload) {
  const c = document.getElementById("trendline-list")!;
  const deduped = dedupeTrendlineItems(collectTrendlineItems()).slice(0, 5);
  document.getElementById("tl-count")!.textContent = String(deduped.length);

  if (!deduped.length) { c.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Chưa phát hiện đường xu hướng</div>'; return; }
  c.innerHTML = deduped.map(({ timeframe, trendline: t }) => {
    const isSup = t.type.includes("support");
    const tierLabel = t.tier === "primary" ? "chính" : "phụ";
    const typeLabel = isSup ? `▲ Hỗ trợ ${tierLabel}` : `▼ Kháng cự ${tierLabel}`;
    const proxLabels: Record<string, string> = { far: "", near: "gần", approaching: "tiến gần", touch_zone: "chạm", reaction_zone: "phản ứng" };
    const proxLabel = proxLabels[t.proximity] || "";
    const interLabel = t.lastInteraction !== "none" ? t.lastInteraction : "";
    const visualColor = t.visualState === "hot" ? "var(--cyan)" : t.visualState === "near" ? "var(--green)" : t.visualState === "break" ? "var(--red)" : "var(--text2)";
    return `<div class="tl-item"><div><div class="tl-type ${isSup ? "support" : "resistance"}" style="color:${visualColor}">${typeLabel} ~${t.projectedPriceNow.toFixed(2)}</div><div class="tl-info">TF:${timeframe.toUpperCase()} • Touch:${t.touches} ${proxLabel} ${interLabel} ND:${t.normalizedDistance.toFixed(1)}</div></div><div class="tl-strength" style="color:${t.strength >= 60 ? "var(--green)" : "var(--gold)"}">${t.strength}</div></div>`;
  }).join("");
}

function dedupeTrendlines(lines: Trendline[]): Trendline[] {
  if (lines.length === 0) return [];
  lines.sort((a, b) => b.strength - a.strength);
  const result: Trendline[] = [];
  for (const line of lines) {
    const isDuplicate = result.some((existing) =>
      existing.type === line.type &&
      Math.abs(existing.points.y1 - line.points.y1) / existing.points.y1 < 0.005 &&
      Math.abs(existing.points.y2 - line.points.y2) / existing.points.y2 < 0.005
    );
    if (!isDuplicate) result.push(line);
  }
  return result;
}

function collectTrendlineItems(): TrendlineListItem[] {
  const items: TrendlineListItem[] = [];
  const entries = Array.from(pipeline.getState().timeframeResults.entries()) as [string, TimeframeAnalysisResult][];
  entries.sort((a, b) => {
    if (a[0] === selectedTf && b[0] !== selectedTf) return -1;
    if (a[0] !== selectedTf && b[0] === selectedTf) return 1;
    return 0;
  });

  for (const [timeframe, result] of entries) {
    for (const trendline of result.trendlines.activeTrendlines) {
      items.push({ timeframe, trendline });
    }
  }

  items.sort((a, b) => {
    if (a.timeframe === selectedTf && b.timeframe !== selectedTf) return -1;
    if (a.timeframe !== selectedTf && b.timeframe === selectedTf) return 1;
    if (a.trendline.tier !== b.trendline.tier) return a.trendline.tier === "primary" ? -1 : 1;
    return b.trendline.strength - a.trendline.strength;
  });
  return items;
}

function dedupeTrendlineItems(items: TrendlineListItem[]): TrendlineListItem[] {
  const result: TrendlineListItem[] = [];
  for (const item of items) {
    const line = item.trendline;
    const isDuplicate = result.some((existing) =>
      existing.timeframe === item.timeframe &&
      existing.trendline.type === line.type &&
      Math.abs(existing.trendline.points.y1 - line.points.y1) / (existing.trendline.points.y1 || 1) < 0.005 &&
      Math.abs(existing.trendline.points.y2 - line.points.y2) / (existing.trendline.points.y2 || 1) < 0.005
    );
    if (!isDuplicate) result.push(item);
  }
  return result;
}

function updateChartAnnotations(payload: UIPayload) {
  const tf = pipeline?.getState().timeframeResults.get(selectedTf) as TimeframeAnalysisResult | undefined;
  const sig = pipeline?.getState().lastSignal;

  if (tf && chartCandleCache.length) {
    renderPatternMarkers(tf.patterns.patterns, chartCandleCache);
  }

  if (chartCandleCache.length) {
    const deduped = tf ? dedupeTrendlines([...tf.trendlines.activeTrendlines]).slice(0, 4) : [];
    renderTrendlines(deduped, chartCandleCache);
  }

  if (sig) renderEntryLines(sig);
  updateChartCallouts(payload);
}

function updateHealthIndicator() {
  if (!healthService) return;
  const health = healthService.getHealth();
  const phase = computeAppPhase(health);

  let el = document.getElementById("health-indicator");
  if (!el) {
    el = document.createElement("div");
    el.id = "health-indicator";
    el.style.cssText = "position:absolute;top:6px;left:6px;z-index:6;display:flex;align-items:center;gap:4px;font-size:10px;pointer-events:none";
    document.getElementById("chart-area")?.appendChild(el);
  }

  const colors: Record<AppPhase, string> = {
    cold_start: "var(--text3)",
    warmup: "var(--gold)",
    live: "var(--green)",
    stale: "var(--gold)",
    disconnected: "var(--red)",
    error: "var(--red)",
  };
  const labels: Record<AppPhase, string> = {
    cold_start: "Khởi tạo",
    warmup: "Đang tải",
    live: "Live",
    stale: "Dữ liệu cũ",
    disconnected: "Mất kết nối",
    error: "Lỗi",
  };

  el.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${colors[phase]};${phase === "live" ? "animation:pulse-dot 1.5s infinite" : ""}"></span><span style="color:${colors[phase]}">${labels[phase]}</span>`;

  if (phase === "stale" && health.staleReason) {
    showError(health.staleReason, true);
  }
}

// ── News ────────────────────────────────────────────────────
let newsLoaded = false;
function getNewsAssetLabel(asset: "all" | "BTC" | "ETH" | "PAXG"): string {
  if (asset === "all") return "Tất cả";
  if (asset === "BTC") return "Bitcoin";
  if (asset === "ETH") return "Ethereum";
  return "Vàng/PAXG";
}

function getVisibleNews(): import("./types").NewsItem[] {
  const news = lastPayload?.news || newsService?.getCachedNews() || [];
  if (currentNewsFilter === "all") return news;
  return news.filter((item) => item.asset === currentNewsFilter);
}

function loadNewsIfNeeded() {
  if (newsLoaded) return;
  newsLoaded = true;
  currentNewsFilter = "all";
  const f = document.getElementById("news-filters")!;
  const allNews = lastPayload?.news || newsService?.getCachedNews() || [];
  const filters: Array<"all" | "BTC" | "ETH" | "PAXG"> = ["all", "BTC", "ETH", "PAXG"];
  f.innerHTML = filters.map((asset, i) => {
    const count = asset === "all" ? allNews.length : allNews.filter((item) => item.asset === asset).length;
    return `<button class="news-filter${i === 0 ? " active" : ""}" data-asset="${asset}"><span>${getNewsAssetLabel(asset)}</span><em>${count}</em></button>`;
  }).join("");
  f.onclick = (e) => {
    const b = (e.target as HTMLElement).closest(".news-filter") as HTMLElement | null;
    if (!b) return;
    currentNewsFilter = (b.dataset.asset as "all" | "BTC" | "ETH" | "PAXG") || "all";
    f.querySelectorAll(".news-filter").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    renderNewsFromPayload();
  };
  renderNewsFromPayload();
}

function renderNewsFromPayload() {
  const l = document.getElementById("news-list")!;
  const news = getVisibleNews();
  if (!news.length) {
    l.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Không có tin tức</div>';
    return;
  }
  l.innerHTML = news.map((n) => {
    const cls = n.sentiment === "negative" ? "negative" : n.sentiment === "positive" ? "positive" : "neutral";
    const lb = n.sentiment === "negative" ? "Tiêu cực" : n.sentiment === "positive" ? "Tích cực" : "Trung tính";
    const desc = n.sentiment === "negative" ? "Có thể gây áp lực giảm giá." : n.sentiment === "positive" ? "Có thể hỗ trợ đà tăng." : "Tác động không rõ ràng.";
    const time = new Date(n.publishedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    const impactBadge = n.impact === "high" ? "Cao" : n.impact === "medium" ? "Vừa" : "Thấp";
    const assetTag = n.asset === "general" ? "NEWS" : n.asset;
    return `
      <div class="news-card">
        <div class="news-card-header">
          <div class="news-source-wrap">
            <span class="news-asset-tag">${assetTag}</span>
            <span class="news-source">${n.source}</span>
          </div>
          <div class="news-time">${time}</div>
        </div>
        <div class="news-title">${n.title}</div>
        <div class="news-desc">${n.summary || "Không có mô tả chi tiết."}</div>
        <a class="news-link" href="https://www.google.com/search?q=${encodeURIComponent(n.title)}" target="_blank" rel="noreferrer">Xem thêm</a>
        <div class="news-sentiment ${cls}">
          <strong>${lb} (${n.confidence}%)</strong>
          <span>${desc} · Impact ${impactBadge}</span>
        </div>
      </div>
    `;
  }).join("");
}

// ── TF Switch ───────────────────────────────────────────────
async function switchTimeframe(tf: string) {
  selectedTf = tf;
  const cache = pipeline?.getState().candleCache.get(tf);
  if (cache?.length) { chartCandleCache = [...cache]; }
  else { try { const c = await feed.fetchKlines(currentSymbol, tf, CANDLE_LIMIT); pipeline.initializeCache(tf, c); chartCandleCache = c; } catch { return; } }
  renderChartData();
  if (lastPayload) { updateTimeframeCards(lastPayload); updateChartAnnotations(lastPayload); }
}

// ── Tabs ────────────────────────────────────────────────────
function setupTabs() {
  document.getElementById("tabs")!.onclick = (e) => {
    const b = (e.target as HTMLElement).closest(".tab") as HTMLElement;
    if (!b) return;
    document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".panel").forEach(p => p.classList.remove("active"));
    document.getElementById(`panel-${b.dataset.tab}`)?.classList.add("active");
    if (b.dataset.tab === "analysis") loadNewsIfNeeded();
  };
}

function setupSymbolSelector() {
  const s = document.getElementById("symbol-select") as HTMLSelectElement;
  s.innerHTML = SymbolMapping.all().map((d) =>
    `<option value="${d.symbol}">${d.displayLabel}</option>`
  ).join("");
  s.value = currentSymbol;
  s.onchange = () => {
    newsLoaded = false;
    loadSymbol(s.value);
  };
}

// ── Loading / Error ─────────────────────────────────────────
let loadingTimeout: any = null;
function showLoading(show: boolean, msg?: string) {
  const el = document.getElementById("loading-overlay")!;
  if (loadingTimeout) { clearTimeout(loadingTimeout); loadingTimeout = null; }
  if (show) {
    el.classList.remove("hidden");
    const p = el.querySelector("p");
    if (p && msg) p.textContent = msg;
    loadingTimeout = setTimeout(() => {
      el.classList.add("hidden");
      log("Loading timeout - force hiding overlay");
    }, 20000);
  } else {
    el.classList.add("hidden");
  }
}
function showError(msg: string, withRetry = false) {
  let el = document.getElementById("error-banner");
  if (!el) { el = document.createElement("div"); el.id = "error-banner"; document.getElementById("app")!.prepend(el); }
  const retryHtml = withRetry ? `<button id="retry-btn">Thử lại</button>` : "";
  el.innerHTML = `<span>${msg}</span><div style="display:flex;gap:8px;align-items:center">${retryHtml}<button class="close-btn">✕</button></div>`;
  el.style.cssText = "background:#3d1111;color:#ff6b6b;padding:10px 14px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #5a1a1a;flex-shrink:0";
  el.querySelectorAll("button").forEach(btn => {
    btn.style.cssText = "background:none;border:1px solid #ff6b6b;color:#ff6b6b;font-size:12px;cursor:pointer;padding:4px 10px;border-radius:4px";
  });
  const retryBtn = el.querySelector("#retry-btn");
  if (retryBtn) retryBtn.addEventListener("click", () => { hideError(); loadSymbol(currentSymbol); });
  const closeBtn = el.querySelector(".close-btn");
  if (closeBtn) closeBtn.addEventListener("click", () => hideError());
}
function hideError() { document.getElementById("error-banner")?.remove(); }
function log(m: string) { console.log("[PTKT] " + m); }

// ── Start ───────────────────────────────────────────────────
init().catch((e) => {
  log("Init failed: " + e.message);
  showLoading(false);
  showError("Lỗi khởi tạo ứng dụng. Nhấn nút để thử lại.", true);
});
