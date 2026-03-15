import "./styles.css";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, LineStyle, CandlestickData, LineData } from "lightweight-charts";
import { Pipeline, TimeframeAnalysisResult } from "./services/Pipeline";
import { BrowserFeed } from "./services/BrowserFeed";
import { CandleStateManager } from "./services/CandleStateManager";
import { Candle, UIPayload, PatternSignal, Trendline, TradingSignal } from "./types";

const TIMEFRAMES = ["15m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"];
const CANDLE_LIMIT = 200;

let currentSymbol = "BTCUSDT";
let selectedTf = "1h";
let pipeline: Pipeline;
let feed: BrowserFeed;
let candleManager: CandleStateManager;
let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let trendlineSeriesList: ISeriesApi<"Line">[] = [];
let priceLines: any[] = [];
let lastPayload: UIPayload | null = null;
let currentPrice = 0;
let chartCandleCache: Candle[] = [];
let loadedTfCount = 0;

// ── Bootstrap ───────────────────────────────────────────────
async function init() {
  log("Khởi động ứng dụng...");
  setupTabs();
  setupSymbolSelector();
  await loadSymbol(currentSymbol);
}

async function loadSymbol(symbol: string) {
  showLoading(true, "Đang kết nối đến thị trường...");
  currentSymbol = symbol;
  loadedTfCount = 0;

  if (feed) feed.close();
  feed = new BrowserFeed();
  pipeline = new Pipeline(symbol);
  candleManager = new CandleStateManager();

  // Load historical data for each timeframe
  let firstLoaded = false;
  for (const tf of TIMEFRAMES) {
    try {
      showLoading(true, `Đang tải ${tf.toUpperCase()}... (${loadedTfCount}/${TIMEFRAMES.length})`);
      const candles = await feed.fetchKlines(symbol, tf, CANDLE_LIMIT);
      if (candles.length > 0) {
        pipeline.initializeCache(tf, candles);
        loadedTfCount++;
        log(`✓ ${tf}: ${candles.length} nến`);

        if (tf === selectedTf || (!firstLoaded && candles.length > 20)) {
          chartCandleCache = candles;
          if (!firstLoaded) { selectedTf = tf; firstLoaded = true; }
        }
      }
    } catch (err: any) {
      log(`✗ ${tf}: ${err.message || err}`);
    }
  }

  if (loadedTfCount === 0) {
    showLoading(false);
    showError("Không thể tải dữ liệu thị trường. Vui lòng kiểm tra kết nối internet và thử lại.");
    return;
  }

  // Get current price
  try {
    currentPrice = await feed.fetchPrice(symbol);
    log(`Giá hiện tại: ${currentPrice}`);
  } catch {
    const lastCandle = chartCandleCache[chartCandleCache.length - 1];
    currentPrice = lastCandle?.close || 0;
    log(`Dùng giá từ nến cuối: ${currentPrice}`);
  }

  // Setup chart and render
  showLoading(true, "Đang vẽ biểu đồ...");
  await waitForLayout();
  setupChart();
  renderChartData();

  // Run analysis
  showLoading(true, "Đang phân tích thị trường...");
  const payload = pipeline.runFullAnalysis(currentPrice);
  lastPayload = payload;
  updateUI(payload);

  showLoading(false);
  hideError();

  // Start streaming
  startStream();
}

function waitForLayout(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

// ── Chart Setup ─────────────────────────────────────────────
function setupChart() {
  const container = document.getElementById("chart-container")!;
  container.innerHTML = "";
  trendlineSeriesList = [];
  priceLines = [];

  const w = container.clientWidth || container.offsetWidth || window.innerWidth;
  const h = container.clientHeight || container.offsetHeight || 300;

  chart = createChart(container, {
    width: w,
    height: h,
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
    rightPriceScale: {
      borderColor: "rgba(255,255,255,0.1)",
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: "rgba(255,255,255,0.1)",
      timeVisible: true,
      secondsVisible: false,
    },
    watermark: {
      visible: true,
      text: "Crypto and Forex Trading",
      color: "rgba(255,255,255,0.04)",
      fontSize: 16,
    },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#26a69a",
    downColor: "#ef5350",
    borderVisible: false,
    wickUpColor: "#26a69a",
    wickDownColor: "#ef5350",
  });

  const ro = new ResizeObserver((entries) => {
    if (!chart) return;
    for (const entry of entries) {
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0) chart.resize(width, height);
    }
  });
  ro.observe(container);
}

function renderChartData() {
  if (!candleSeries) return;
  const closed = chartCandleCache.filter((c) => c.isClosed);
  if (closed.length === 0) return;

  const data: CandlestickData[] = closed.map((c) => ({
    time: (c.openTime / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));
  candleSeries.setData(data);
  chart?.timeScale().fitContent();
}

function updateChartCandle(candle: Candle) {
  if (!candleSeries) return;
  candleSeries.update({
    time: (candle.openTime / 1000) as UTCTimestamp,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
  });
}

function renderPatternMarkers(patterns: PatternSignal[], candles: Candle[]) {
  if (!candleSeries) return;
  const closed = candles.filter((c) => c.isClosed);
  const markers: any[] = [];

  const nameMap: Record<string, string> = {
    doji: "Doji", hammer: "Hammer", inverted_hammer: "Inverted Hammer",
    shooting_star: "Shooting Star", bullish_engulfing: "Bullish Engulfing",
    bearish_engulfing: "Bearish Engulfing", morning_star: "Morning Star",
    evening_star: "Evening Star", three_white_soldiers: "3 White Soldiers",
    three_black_crows: "3 Black Crows",
  };

  for (const p of patterns) {
    if (p.candleIndex < 0 || p.candleIndex >= closed.length) continue;
    const c = closed[p.candleIndex];
    const isBull = p.direction === "bullish";
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
  if (!candleSeries) return;
  for (const pl of priceLines) {
    try { candleSeries.removePriceLine(pl); } catch (_) {}
  }
  priceLines = [];
  try {
    if (signal.entryLong) {
      priceLines.push(candleSeries.createPriceLine({ price: signal.entryLong, color: "#26a69a", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Buy ${signal.entryLong.toFixed(2)}` }));
    }
    if (signal.entryShort) {
      priceLines.push(candleSeries.createPriceLine({ price: signal.entryShort, color: "#ef5350", lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: `Sell ${signal.entryShort.toFixed(2)}` }));
    }
    if (signal.target) {
      priceLines.push(candleSeries.createPriceLine({ price: signal.target, color: "#ffd700", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `Target` }));
    }
    if (signal.stopLoss) {
      priceLines.push(candleSeries.createPriceLine({ price: signal.stopLoss, color: "#ff6d00", lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: true, title: `SL` }));
    }
  } catch (_) {}
}

function renderTrendlines(trendlines: Trendline[], candles: Candle[]) {
  if (!chart) return;
  for (const s of trendlineSeriesList) {
    try { chart.removeSeries(s); } catch (_) {}
  }
  trendlineSeriesList = [];

  const closed = candles.filter((c) => c.isClosed);
  if (closed.length === 0) return;

  for (const tl of trendlines.slice(0, 5)) {
    const i1 = Math.max(0, Math.min(tl.points.x1, closed.length - 1));
    const i2 = Math.max(0, Math.min(tl.points.x2, closed.length - 1));
    if (i1 === i2) continue;

    const color = tl.type === "ascending_support" ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)";
    const series = chart.addLineSeries({
      color, lineWidth: 1, lineStyle: LineStyle.LargeDashed,
      crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
    });

    const extIdx = Math.min(i2 + 20, closed.length - 1);
    const projectedPrice = tl.slope * extIdx + tl.intercept;

    const data: LineData[] = [
      { time: (closed[i1].openTime / 1000) as UTCTimestamp, value: tl.points.y1 },
      { time: (closed[i2].openTime / 1000) as UTCTimestamp, value: tl.points.y2 },
    ];
    if (extIdx > i2 && projectedPrice > 0) {
      data.push({ time: (closed[extIdx].openTime / 1000) as UTCTimestamp, value: projectedPrice });
    }
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
    if (tf === selectedTf) { renderChartData(); updateChartAnnotations(payload); }
  });

  feed.subscribe(currentSymbol, TIMEFRAMES, (sym, tf, candle, isClose) => {
    const { closed } = candleManager.update(tf, candle);
    if (!closed) {
      pipeline.updateCandle(tf, candle);
      if (tf === selectedTf) updateChartCandle(candle);
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
  updateSignalSteps();
  updateConfidence();
  updatePriceTag(payload.currentPrice);
  updateTrendlineTab(payload);
  updateChartAnnotations(payload);
}

function updateBiasBar(long: number, short: number) {
  document.getElementById("long-pct")!.textContent = `${long}%`;
  document.getElementById("short-pct")!.textContent = `${short}%`;
  document.getElementById("long-fill")!.style.width = `${long}%`;
  document.getElementById("short-fill")!.style.width = `${short}%`;
}

function updateSignalBadge(direction: string, state: string) {
  const badge = document.getElementById("signal-badge")!;
  if (direction === "long" || state.includes("long")) {
    badge.textContent = "Lệnh Chờ Long"; badge.className = "badge badge-long";
  } else if (direction === "short" || state.includes("short")) {
    badge.textContent = "Lệnh Chờ Short"; badge.className = "badge badge-short";
  } else {
    badge.textContent = "Theo dõi"; badge.className = "badge badge-neutral";
  }
}

function updateTimeframeCards(payload: UIPayload) {
  const row = document.getElementById("tf-row")!;
  row.innerHTML = "";

  for (const tf of TIMEFRAMES) {
    const data = payload.timeframes[tf];
    const card = document.createElement("div");
    const bias = data?.bias || "neutral";
    card.className = `tf-card${tf === selectedTf ? " active" : ""}${bias === "bullish" ? " bullish" : bias === "bearish" ? " bearish" : ""}`;

    const cache = pipeline?.getState().candleCache.get(tf);
    const price = cache && cache.length > 0 ? cache[cache.length - 1].close.toFixed(2) : "---";

    card.innerHTML = `<span class="tf-label">${tf.toUpperCase()}</span><span class="tf-price">${price}</span>`;
    card.addEventListener("click", () => switchTimeframe(tf));
    row.appendChild(card);
  }
}

function updateMarquee(text: string) {
  document.getElementById("marquee-text")!.textContent = text;
}

function updateSignalSteps() {
  const container = document.getElementById("signal-steps")!;
  const signal = pipeline?.getState().lastSignal;
  if (!signal?.steps) {
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
    </div>`).join("");
}

function updateConfidence() {
  const el = document.getElementById("confidence-value")!;
  const conf = pipeline?.getState().lastSignal?.overallConfidence ?? 0;
  el.textContent = `${conf}%`;
  el.style.color = conf >= 70 ? "var(--green)" : conf >= 50 ? "var(--gold)" : "var(--red)";
}

function updatePriceTag(price: number) {
  document.getElementById("current-price-tag")!.textContent = price.toFixed(2);
}

function updateTrendlineTab(payload: UIPayload) {
  document.getElementById("tl-count")!.textContent = String(payload.trendlineCount);
  const container = document.getElementById("trendline-list")!;
  const allTL: Trendline[] = [];
  for (const r of pipeline.getState().timeframeResults.values()) {
    allTL.push(...(r as TimeframeAnalysisResult).trendlines.activeTrendlines);
  }
  if (allTL.length === 0) {
    container.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Chưa phát hiện đường xu hướng đáng chú ý</div>';
    return;
  }
  container.innerHTML = allTL.slice(0, 10).map((tl) => {
    const sup = tl.type === "ascending_support";
    return `<div class="tl-item"><div><div class="tl-type ${sup ? "support" : "resistance"}">${sup ? "▲ Hỗ trợ tăng" : "▼ Kháng cự giảm"}</div><div class="tl-info">Touches: ${tl.touches} | ${tl.lastInteraction} | Dist: ${tl.distanceToPricePercent.toFixed(2)}%</div></div><div class="tl-strength" style="color:${tl.strength >= 60 ? "var(--green)" : tl.strength >= 40 ? "var(--gold)" : "var(--text3)"}">${tl.strength}</div></div>`;
  }).join("");
}

function updateChartAnnotations(payload: UIPayload) {
  const tfResult = pipeline?.getState().timeframeResults.get(selectedTf) as TimeframeAnalysisResult | undefined;
  const signal = pipeline?.getState().lastSignal;
  if (tfResult && chartCandleCache.length > 0) {
    renderPatternMarkers(tfResult.patterns.patterns, chartCandleCache);
    renderTrendlines(tfResult.trendlines.activeTrendlines, chartCandleCache);
  }
  if (signal) renderEntryLines(signal);
}

// ── News ────────────────────────────────────────────────────
let newsLoaded = false;

function loadNewsIfNeeded() {
  if (newsLoaded) return;
  newsLoaded = true;

  const filtersEl = document.getElementById("news-filters")!;
  const cats = ["Tất cả", "Bitcoin", "Ethereum", "Solana", "XRP"];
  filtersEl.innerHTML = cats.map((c, i) => `<button class="news-filter${i === 0 ? " active" : ""}" data-cat="${c}">${c}</button>`).join("");
  filtersEl.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest(".news-filter") as HTMLElement;
    if (!btn) return;
    filtersEl.querySelectorAll(".news-filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
  });
  fetchNews();
}

async function fetchNews() {
  const list = document.getElementById("news-list")!;
  list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Đang tải tin tức...</div>';
  try {
    const res = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest");
    const data = await res.json();
    const articles = (data.Data || []).slice(0, 8);
    if (articles.length === 0) { list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Không có tin tức</div>'; return; }

    list.innerHTML = articles.map((a: any) => {
      const s = analyzeSentiment(a.title + " " + (a.body || ""));
      const cls = s.score < 40 ? "negative" : s.score > 60 ? "positive" : "neutral";
      const label = s.score < 40 ? "Tiêu cực" : s.score > 60 ? "Tích cực" : "Trung tính";
      const time = new Date(a.published_on * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      return `<div class="news-card"><div class="news-source">${a.source_info?.name || a.source} · ${time}</div><div class="news-title">${a.title}</div><div class="news-sentiment ${cls}"><strong>Phân tích cảm xúc: ${label} (${s.score}%)</strong><br>${s.description}</div></div>`;
    }).join("");
  } catch {
    list.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Không thể tải tin tức</div>';
  }
}

function analyzeSentiment(text: string) {
  const l = text.toLowerCase();
  const pos = ["bull","surge","rally","gain","up","high","rise","positive","growth","recover","pump","breakout","buy","strong","boost"];
  const neg = ["bear","crash","drop","fall","down","low","decline","negative","loss","sell","dump","fear","risk","warn","weak","plunge"];
  let p = 0, n = 0;
  for (const w of pos) if (l.includes(w)) p++;
  for (const w of neg) if (l.includes(w)) n++;
  const t = p + n || 1;
  const score = Math.round((p / t) * 100);
  if (score < 40) return { score, description: "Tin tức này có tác động tiêu cực mạnh đến thị trường. Có thể gây áp lực giảm giá." };
  if (score > 60) return { score, description: "Tin tức này có tác động tích cực đến thị trường. Có thể hỗ trợ đà tăng." };
  return { score: 50, description: "Tin tức trung tính, tác động không rõ ràng." };
}

// ── Timeframe Switch ────────────────────────────────────────
async function switchTimeframe(tf: string) {
  selectedTf = tf;
  const cache = pipeline?.getState().candleCache.get(tf);
  if (cache && cache.length > 0) {
    chartCandleCache = [...cache];
  } else {
    try {
      const candles = await feed.fetchKlines(currentSymbol, tf, CANDLE_LIMIT);
      pipeline.initializeCache(tf, candles);
      chartCandleCache = candles;
    } catch { return; }
  }
  renderChartData();
  if (lastPayload) { updateTimeframeCards(lastPayload); updateChartAnnotations(lastPayload); }
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
    document.getElementById(`panel-${tabName}`)?.classList.add("active");
    if (tabName === "analysis") loadNewsIfNeeded();
  });
}

// ── Symbol Select ───────────────────────────────────────────
function setupSymbolSelector() {
  const sel = document.getElementById("symbol-select") as HTMLSelectElement;
  sel.value = currentSymbol;
  sel.addEventListener("change", () => loadSymbol(sel.value));
}

// ── Loading / Error ─────────────────────────────────────────
function showLoading(show: boolean, msg?: string) {
  const el = document.getElementById("loading-overlay")!;
  if (show) {
    el.classList.remove("hidden");
    const p = el.querySelector("p");
    if (p && msg) p.textContent = msg;
  } else {
    el.classList.add("hidden");
  }
}

function showError(msg: string) {
  let el = document.getElementById("error-banner");
  if (!el) {
    el = document.createElement("div");
    el.id = "error-banner";
    document.getElementById("app")!.prepend(el);
  }
  el.innerHTML = `<span>${msg}</span><button onclick="this.parentElement.remove()">✕</button>`;
  el.style.cssText = "background:#3d1111;color:#ff6b6b;padding:10px 14px;font-size:12px;display:flex;align-items:center;justify-content:space-between;gap:8px;border-bottom:1px solid #5a1a1a;flex-shrink:0";
  el.querySelector("button")!.style.cssText = "background:none;border:none;color:#ff6b6b;font-size:16px;cursor:pointer;padding:0 4px";
}

function hideError() {
  document.getElementById("error-banner")?.remove();
}

function log(msg: string) {
  console.log(`[PTKT] ${msg}`);
}

// ── Start ───────────────────────────────────────────────────
init();
