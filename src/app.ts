import "./styles.css";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, LineStyle, CandlestickData, LineData } from "lightweight-charts";
import { Pipeline } from "./services/Pipeline";
import { BrowserFeed } from "./services/BrowserFeed";
import { CandleStateManager } from "./services/CandleStateManager";
import { Candle, UIPayload, PatternSignal, Trendline, TradingSignal } from "./types";

const TIMEFRAMES = ["6h", "8h", "12h", "1h", "2h", "4h", "1d", "1w"];
const CANDLE_LIMIT = 200;

let currentSymbol = "BTCUSDT";
let selectedTf = "2h";
let pipeline: Pipeline;
let feed: BrowserFeed;
let candleManager: CandleStateManager;
let chart: IChartApi;
let candleSeries: ISeriesApi<"Candlestick">;
let trendlineSeriesList: ISeriesApi<"Line">[] = [];
let lastPayload: UIPayload | null = null;
let currentPrice = 0;
let chartCandleCache: Candle[] = [];

// ── Bootstrap ───────────────────────────────────────────────
async function init() {
  setupTabs();
  setupSymbolSelector();

  await loadSymbol(currentSymbol);
}

async function loadSymbol(symbol: string) {
  showLoading(true);
  currentSymbol = symbol;

  if (feed) feed.close();
  feed = new BrowserFeed();
  pipeline = new Pipeline(symbol);
  candleManager = new CandleStateManager();

  try {
    for (const tf of TIMEFRAMES) {
      try {
        const candles = await feed.fetchKlines(symbol, tf, CANDLE_LIMIT);
        pipeline.initializeCache(tf, candles);
        if (tf === selectedTf) chartCandleCache = candles;
      } catch (_) {}
    }

    currentPrice = await feed.fetchPrice(symbol);
    setupChart();
    renderChartData();

    const payload = pipeline.runFullAnalysis(currentPrice);
    lastPayload = payload;
    updateUI(payload);

    startStream();
  } catch (err: any) {
    console.error("Init error:", err);
  } finally {
    showLoading(false);
  }
}

// ── Chart Setup ─────────────────────────────────────────────
function setupChart() {
  const container = document.getElementById("chart-container")!;
  container.innerHTML = "";
  trendlineSeriesList = [];

  chart = createChart(container, {
    width: container.clientWidth,
    height: container.clientHeight,
    layout: {
      background: { color: "#0a0e17" } as any,
      textColor: "#9e9e9e",
      fontSize: 10,
    },
    grid: {
      vertLines: { color: "rgba(255,255,255,0.04)" },
      horzLines: { color: "rgba(255,255,255,0.04)" },
    },
    crosshair: { mode: 0 },
    rightPriceScale: { borderColor: "rgba(255,255,255,0.1)" },
    timeScale: {
      borderColor: "rgba(255,255,255,0.1)",
      timeVisible: true,
      secondsVisible: false,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });

  const ro = new ResizeObserver(() => {
    chart.resize(container.clientWidth, container.clientHeight);
  });
  ro.observe(container);
}

function renderChartData() {
  const closed = chartCandleCache.filter((c) => c.isClosed);
  const data: CandlestickData[] = closed.map((c) => ({
    time: (c.openTime / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  candleSeries.setData(data);
  chart.timeScale().fitContent();
}

function updateChartCandle(candle: Candle) {
  candleSeries.update({
    time: (candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  });
}

function renderPatternMarkers(patterns: PatternSignal[], candles: Candle[]) {
  const closed = candles.filter((c) => c.isClosed);
  const markers: any[] = [];

  for (const p of patterns) {
    const idx = p.candleIndex;
    if (idx < 0 || idx >= closed.length) continue;
    const c = closed[idx];
    const isBull = p.direction === "bullish";

    const nameMap: Record<string, string> = {
      doji: "Doji",
      hammer: "Hammer",
      shooting_star: "Shooting Star",
      bullish_engulfing: "Bullish Engulfing",
      bearish_engulfing: "Bearish Engulfing",
      morning_star: "Morning Star",
      evening_star: "Evening Star",
      three_white_soldiers: "3 White Soldiers",
      three_black_crows: "3 Black Crows",
    };

    markers.push({
      time: (c.openTime / 1000) as UTCTimestamp,
      position: isBull ? "belowBar" : "aboveBar",
      color: isBull ? "#26a69a" : "#ef5350",
      shape: isBull ? "arrowUp" : "arrowDown",
      text: nameMap[p.pattern] || p.pattern,
    });
  }

  markers.sort((a: any, b: any) => (a.time as number) - (b.time as number));
  candleSeries.setMarkers(markers);
}

function renderEntryLines(signal: TradingSignal) {
  // Remove old price lines by recreating them (lightweight-charts limitation)
  // We'll just create new ones each time
  try {
    if (signal.entryLong) {
      candleSeries.createPriceLine({
        price: signal.entryLong,
        color: "#26a69a",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Buy ${signal.entryLong.toFixed(2)}`,
      });
    }
    if (signal.entryShort) {
      candleSeries.createPriceLine({
        price: signal.entryShort,
        color: "#ef5350",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        axisLabelVisible: true,
        title: `Sell ${signal.entryShort.toFixed(2)}`,
      });
    }
    if (signal.target) {
      candleSeries.createPriceLine({
        price: signal.target,
        color: "#ffd700",
        lineWidth: 1,
        lineStyle: LineStyle.Dotted,
        axisLabelVisible: true,
        title: `Target ${signal.target.toFixed(2)}`,
      });
    }
  } catch (_) {}
}

function renderTrendlines(trendlines: Trendline[], candles: Candle[]) {
  for (const s of trendlineSeriesList) {
    try { chart.removeSeries(s); } catch (_) {}
  }
  trendlineSeriesList = [];

  const closed = candles.filter((c) => c.isClosed);
  for (const tl of trendlines.slice(0, 5)) {
    const i1 = tl.points.x1;
    const i2 = tl.points.x2;
    if (i1 < 0 || i2 < 0 || i1 >= closed.length || i2 >= closed.length) continue;

    const color = tl.type === "ascending_support" ? "rgba(38,166,154,0.6)" : "rgba(239,83,80,0.6)";
    const series = chart.addLineSeries({
      color,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    const data: LineData[] = [
      { time: (closed[i1].openTime / 1000) as UTCTimestamp, value: tl.points.y1 },
      { time: (closed[i2].openTime / 1000) as UTCTimestamp, value: tl.points.y2 },
    ];
    series.setData(data);
    trendlineSeriesList.push(series);
  }
}

// ── Streaming ───────────────────────────────────────────────
function startStream() {
  candleManager = new CandleStateManager();

  candleManager.setOnCandleClose((tf, candle) => {
    pipeline.updateCandle(tf, candle);
    if (tf === selectedTf) {
      chartCandleCache.push(candle);
      if (chartCandleCache.length > 500) chartCandleCache.splice(0, chartCandleCache.length - 500);
    }

    const payload = pipeline.runFullAnalysis(candle.close);
    lastPayload = payload;
    updateUI(payload);

    if (tf === selectedTf) {
      renderChartData();
      updateChartAnnotations(payload);
    }
  });

  feed.subscribe(currentSymbol, TIMEFRAMES, (sym, tf, candle, isClose) => {
    const { closed } = candleManager.update(tf, candle);
    if (!closed) {
      pipeline.updateCandle(tf, candle);
      if (tf === selectedTf) {
        updateChartCandle(candle);
      }
      currentPrice = candle.close;
      updatePriceTag(candle.close);
    }
  });
}

// ── UI Updates ──────────────────────────────────────────────
function updateUI(payload: UIPayload) {
  updateBiasBar(payload.globalBias.long, payload.globalBias.short);
  updateSignalBadge(payload.signal.direction, payload.signal.state);
  updateTimeframeCards(payload);
  updateMarquee(payload.signal.summary);
  updateSignalSteps(payload);
  updateConfidence(payload);
  updatePriceTag(payload.currentPrice);
  updateTrendlineTab(payload);
  updateChartAnnotations(payload);
  updateNewsPanel();
}

function updateBiasBar(long: number, short: number) {
  const lEl = document.getElementById("long-pct")!;
  const sEl = document.getElementById("short-pct")!;
  const lFill = document.getElementById("long-fill")!;
  const sFill = document.getElementById("short-fill")!;

  lEl.textContent = `${long}%`;
  sEl.textContent = `${short}%`;
  lFill.style.width = `${long}%`;
  sFill.style.width = `${short}%`;
}

function updateSignalBadge(direction: string, state: string) {
  const badge = document.getElementById("signal-badge")!;
  if (direction === "long" || state.includes("long")) {
    badge.textContent = "Lệnh Chờ Long";
    badge.className = "badge badge-long";
  } else if (direction === "short" || state.includes("short")) {
    badge.textContent = "Lệnh Chờ Short";
    badge.className = "badge badge-short";
  } else {
    badge.textContent = "Theo dõi";
    badge.className = "badge badge-neutral";
  }
}

function updateTimeframeCards(payload: UIPayload) {
  const row = document.getElementById("tf-row")!;
  row.innerHTML = "";

  for (const tf of TIMEFRAMES) {
    const data = payload.timeframes[tf];
    const card = document.createElement("div");
    card.className = `tf-card ${tf === selectedTf ? "active" : ""} ${data ? data.bias === "bullish" ? "bullish" : data.bias === "bearish" ? "bearish" : "" : ""}`;

    const score = data ? (data.bias === "bullish" ? data.long : data.short) : 50;
    const price = getPriceForTf(tf);

    card.innerHTML = `<span class="tf-label">${tf.toUpperCase()}</span><span class="tf-price">${price}</span>`;

    card.addEventListener("click", () => switchTimeframe(tf));
    row.appendChild(card);
  }
}

function getPriceForTf(tf: string): string {
  const cache = pipeline?.getState().candleCache.get(tf);
  if (!cache || cache.length === 0) return "---";
  const last = cache[cache.length - 1];
  return last.close.toFixed(2);
}

function updateMarquee(text: string) {
  const el = document.getElementById("marquee-text")!;
  el.textContent = text;
}

function updateSignalSteps(payload: UIPayload) {
  const container = document.getElementById("signal-steps")!;
  const signal = pipeline.getState().lastSignal;
  if (!signal || !signal.steps) {
    container.innerHTML = '<div class="step-card pending"><div class="step-num">?</div><div class="step-body"><div class="step-title">Đang phân tích...</div></div></div>';
    return;
  }

  container.innerHTML = signal.steps.map((s) => `
    <div class="step-card ${s.status}">
      <div class="step-num">${s.step}</div>
      <div class="step-body">
        <div class="step-title">${s.title}</div>
        <div class="step-desc">${s.description}</div>
      </div>
    </div>
  `).join("");
}

function updateConfidence(payload: UIPayload) {
  const el = document.getElementById("confidence-value")!;
  const signal = pipeline.getState().lastSignal;
  const conf = signal?.overallConfidence ?? 0;
  el.textContent = `${conf}%`;
  el.style.color = conf >= 70 ? "var(--green)" : conf >= 50 ? "var(--gold)" : "var(--red)";
}

function updatePriceTag(price: number) {
  const el = document.getElementById("current-price-tag")!;
  el.textContent = price.toFixed(2);
}

function updateTrendlineTab(payload: UIPayload) {
  document.getElementById("tl-count")!.textContent = String(payload.trendlineCount);

  const container = document.getElementById("trendline-list")!;
  const results = Array.from(pipeline.getState().timeframeResults.values());
  const allTL: Trendline[] = [];
  for (const r of results) {
    allTL.push(...r.trendlines.activeTrendlines);
  }

  if (allTL.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Chưa phát hiện đường xu hướng đáng chú ý</div>';
    return;
  }

  container.innerHTML = allTL.slice(0, 10).map((tl) => {
    const isSupport = tl.type === "ascending_support";
    return `<div class="tl-item">
      <div>
        <div class="tl-type ${isSupport ? "support" : "resistance"}">${isSupport ? "▲ Hỗ trợ tăng" : "▼ Kháng cự giảm"}</div>
        <div class="tl-info">Touches: ${tl.touches} | ${tl.lastInteraction} | Dist: ${tl.distanceToPricePercent.toFixed(2)}%</div>
      </div>
      <div class="tl-strength" style="color:${tl.strength >= 60 ? "var(--green)" : tl.strength >= 40 ? "var(--gold)" : "var(--text3)"}">${tl.strength}</div>
    </div>`;
  }).join("");
}

function updateChartAnnotations(payload: UIPayload) {
  const tfResult = pipeline.getState().timeframeResults.get(selectedTf);
  const signal = pipeline.getState().lastSignal;

  if (tfResult && chartCandleCache.length > 0) {
    renderPatternMarkers(tfResult.patterns.patterns, chartCandleCache);
    renderTrendlines(tfResult.trendlines.activeTrendlines, chartCandleCache);
  }

  if (signal) {
    renderEntryLines(signal);
  }
}

// ── News ────────────────────────────────────────────────────
const newsCategories = ["Tất cả", "Bitcoin", "Ethereum", "Solana", "XRP"];
let activeNewsFilter = "Tất cả";

function updateNewsPanel() {
  const filtersEl = document.getElementById("news-filters")!;
  if (filtersEl.children.length === 0) {
    filtersEl.innerHTML = newsCategories.map((c) =>
      `<button class="news-filter ${c === activeNewsFilter ? "active" : ""}" data-cat="${c}">${c}</button>`
    ).join("");

    filtersEl.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest(".news-filter") as HTMLElement;
      if (!btn) return;
      activeNewsFilter = btn.dataset.cat || "Tất cả";
      filtersEl.querySelectorAll(".news-filter").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      fetchNews();
    });
  }

  fetchNews();
}

async function fetchNews() {
  const list = document.getElementById("news-list")!;
  try {
    const res = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest");
    const data = await res.json();
    const articles = (data.Data || []).slice(0, 8);

    list.innerHTML = articles.map((a: any) => {
      const sentiment = analyzeSentiment(a.title + " " + (a.body || ""));
      const sentClass = sentiment.score < 40 ? "negative" : sentiment.score > 60 ? "positive" : "neutral";
      const sentLabel = sentiment.score < 40 ? "Tiêu cực" : sentiment.score > 60 ? "Tích cực" : "Trung tính";
      const time = new Date(a.published_on * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", year: "numeric" });

      return `<div class="news-card">
        <div class="news-source">${a.source_info?.name || a.source} · ${time}</div>
        <div class="news-title">${a.title}</div>
        <div class="news-sentiment ${sentClass}">
          <strong>Phân tích cảm xúc: ${sentLabel} (${sentiment.score}%)</strong><br>
          ${sentiment.description}
        </div>
      </div>`;
    }).join("");
  } catch (_) {
    list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Không thể tải tin tức</div>';
  }
}

function analyzeSentiment(text: string): { score: number; description: string } {
  const lower = text.toLowerCase();
  const positiveWords = ["bull", "surge", "rally", "gain", "up", "high", "rise", "positive", "growth", "recover", "pump", "breakout", "buy"];
  const negativeWords = ["bear", "crash", "drop", "fall", "down", "low", "decline", "negative", "loss", "sell", "dump", "fear", "risk", "warn"];

  let pos = 0, neg = 0;
  for (const w of positiveWords) if (lower.includes(w)) pos++;
  for (const w of negativeWords) if (lower.includes(w)) neg++;

  const total = pos + neg || 1;
  const score = Math.round((pos / total) * 100);

  if (score < 40) return { score, description: "Tin tức này có tác động tiêu cực mạnh đến thị trường. Có thể gây áp lực giảm giá." };
  if (score > 60) return { score, description: "Tin tức này có tác động tích cực đến thị trường. Có thể hỗ trợ đà tăng." };
  return { score: 50, description: "Tin tức trung tính, tác động không rõ ràng." };
}

// ── Timeframe Switch ────────────────────────────────────────
async function switchTimeframe(tf: string) {
  selectedTf = tf;
  const cache = pipeline.getState().candleCache.get(tf);
  if (cache && cache.length > 0) {
    chartCandleCache = [...cache];
  } else {
    try {
      const candles = await feed.fetchKlines(currentSymbol, tf, CANDLE_LIMIT);
      pipeline.initializeCache(tf, candles);
      chartCandleCache = candles;
    } catch (_) {
      return;
    }
  }

  renderChartData();
  if (lastPayload) {
    updateTimeframeCards(lastPayload);
    updateChartAnnotations(lastPayload);
  }
}

// ── Tabs ────────────────────────────────────────────────────
function setupTabs() {
  document.getElementById("tabs")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".tab") as HTMLElement;
    if (!btn) return;
    const tabName = btn.dataset.tab;

    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");

    document.querySelectorAll(".panel").forEach((p) => p.classList.remove("active"));
    const panel = document.getElementById(`panel-${tabName}`);
    if (panel) panel.classList.add("active");
  });
}

// ── Symbol Select ───────────────────────────────────────────
function setupSymbolSelector() {
  const sel = document.getElementById("symbol-select") as HTMLSelectElement;
  sel.value = currentSymbol;
  sel.addEventListener("change", () => {
    loadSymbol(sel.value);
  });
}

// ── Loading ─────────────────────────────────────────────────
function showLoading(show: boolean) {
  const el = document.getElementById("loading-overlay")!;
  if (show) el.classList.remove("hidden");
  else el.classList.add("hidden");
}

// ── Extended Pipeline State (expose timeframeResults) ───────
declare module "./services/Pipeline" {
  interface Pipeline {
    getState(): import("./services/Pipeline").PipelineState & {
      timeframeResults: Map<string, any>;
    };
  }
}

// ── Start ───────────────────────────────────────────────────
init();
