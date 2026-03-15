import "./styles.css";
import { createChart, IChartApi, ISeriesApi, UTCTimestamp, LineStyle, CandlestickData, LineData } from "lightweight-charts";
import { Pipeline, TimeframeAnalysisResult } from "./services/Pipeline";
import { BrowserFeed } from "./services/BrowserFeed";
import { CandleStateManager } from "./services/CandleStateManager";
import { Candle, UIPayload, PatternSignal, Trendline, TradingSignal } from "./types";

const CRYPTO_TIMEFRAMES = ["15m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w"];
const FOREX_TIMEFRAMES = ["15m", "1h", "4h", "1d"];
const CANDLE_LIMIT = 150;

function getTimeframes(symbol: string): string[] {
  return symbol.toUpperCase().startsWith("XAU") ? FOREX_TIMEFRAMES : CRYPTO_TIMEFRAMES;
}

let TIMEFRAMES = CRYPTO_TIMEFRAMES;
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

// ── Bootstrap ───────────────────────────────────────────────
async function init() {
  log("App starting");
  setupTabs();
  setupSymbolSelector();
  setupChart();
  await loadSymbol(currentSymbol);
}

async function loadSymbol(symbol: string) {
  showLoading(true, "Đang kết nối...");

  try {
    currentSymbol = symbol;
    TIMEFRAMES = getTimeframes(symbol);

    if (feed) feed.close();
    feed = new BrowserFeed();
    pipeline = new Pipeline(symbol);
    candleManager = new CandleStateManager();
    chartCandleCache = [];

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
      showError("Không thể tải dữ liệu. Nhấn nút để thử lại.", true);
      return;
    }

    try {
      currentPrice = await feed.fetchPrice(symbol);
    } catch {
      currentPrice = chartCandleCache[chartCandleCache.length - 1]?.close || 0;
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

    try {
      const payload = pipeline.runFullAnalysis(currentPrice);
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
    showError("Lỗi tải dữ liệu: " + (e.message || "Không rõ") + ". Nhấn nút để thử lại.", true);
  } finally {
    showLoading(false);
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
    watermark: { visible: true, text: "Crypto and Forex Trading", color: "rgba(255,255,255,0.04)", fontSize: 16 },
  });

  candleSeries = chart.addCandlestickSeries({
    upColor: "#26a69a", downColor: "#ef5350", borderVisible: false,
    wickUpColor: "#26a69a", wickDownColor: "#ef5350",
  });

  new ResizeObserver((entries) => {
    if (!chart) return;
    const { width, height } = entries[0].contentRect;
    if (width > 0 && height > 0) chart.resize(width, height);
  }).observe(container);

  log("Chart created: " + w + "x" + Math.max(h, 250));
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
  if (!candleSeries) return;
  const closed = candles.filter((c) => c.isClosed);
  const nameMap: Record<string, string> = {
    doji: "Doji", hammer: "Hammer", inverted_hammer: "Inv Hammer",
    shooting_star: "Shoot Star", bullish_engulfing: "Bull Engulf",
    bearish_engulfing: "Bear Engulf", morning_star: "Morn Star",
    evening_star: "Eve Star", three_white_soldiers: "3WS", three_black_crows: "3BC",
  };
  const markers: any[] = [];
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
  markers.sort((a: any, b: any) => (a.time as number) - (b.time as number));
  candleSeries.setMarkers(markers);
}

function renderEntryLines(signal: TradingSignal) {
  if (!candleSeries) return;
  for (const pl of priceLines) { try { candleSeries.removePriceLine(pl); } catch {} }
  priceLines = [];
  const add = (price: number | undefined, color: string, style: any, title: string) => {
    if (!price || !candleSeries) return;
    try { priceLines.push(candleSeries.createPriceLine({ price, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title })); } catch {}
  };
  add(signal.entryLong, "#26a69a", LineStyle.Dashed, `Buy ${signal.entryLong?.toFixed(2)}`);
  add(signal.entryShort, "#ef5350", LineStyle.Dashed, `Sell ${signal.entryShort?.toFixed(2)}`);
  add(signal.target, "#ffd700", LineStyle.Dotted, "Target");
  add(signal.stopLoss, "#ff6d00", LineStyle.Dotted, "SL");
}

function renderTrendlines(trendlines: Trendline[], candles: Candle[]) {
  if (!chart) return;
  for (const s of trendlineSeriesList) { try { chart.removeSeries(s); } catch {} }
  trendlineSeriesList = [];
  const closed = candles.filter((c) => c.isClosed);
  if (closed.length === 0) return;
  for (const tl of trendlines.slice(0, 4)) {
    const i1 = Math.max(0, Math.min(tl.points.x1, closed.length - 1));
    const i2 = Math.max(0, Math.min(tl.points.x2, closed.length - 1));
    if (i1 === i2) continue;
    const color = tl.type === "ascending_support" ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)";
    const series = chart.addLineSeries({
      color, lineWidth: 1, lineStyle: LineStyle.LargeDashed,
      crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
    });
    const data: LineData[] = [
      { time: (closed[i1].openTime / 1000) as UTCTimestamp, value: tl.points.y1 },
      { time: (closed[i2].openTime / 1000) as UTCTimestamp, value: tl.points.y2 },
    ];
    const ext = Math.min(i2 + 15, closed.length - 1);
    if (ext > i2) {
      const p = tl.slope * ext + tl.intercept;
      if (p > 0) data.push({ time: (closed[ext].openTime / 1000) as UTCTimestamp, value: p });
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
    try {
      const payload = pipeline.runFullAnalysis(candle.close);
      lastPayload = payload;
      updateUI(payload);
      if (tf === selectedTf) { renderChartData(); updateChartAnnotations(payload); }
    } catch {}
  });

  feed.subscribe(currentSymbol, TIMEFRAMES, (_sym, tf, candle, _isClose) => {
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
}

function updateBiasBar(l: number, s: number) {
  document.getElementById("long-pct")!.textContent = `${l}%`;
  document.getElementById("short-pct")!.textContent = `${s}%`;
  document.getElementById("long-fill")!.style.width = `${l}%`;
  document.getElementById("short-fill")!.style.width = `${s}%`;
}

function updateSignalBadge(dir: string, state: string) {
  const b = document.getElementById("signal-badge")!;
  if (dir === "long" || state.includes("long")) { b.textContent = "Lệnh Chờ Long"; b.className = "badge badge-long"; }
  else if (dir === "short" || state.includes("short")) { b.textContent = "Lệnh Chờ Short"; b.className = "badge badge-short"; }
  else { b.textContent = "Theo dõi"; b.className = "badge badge-neutral"; }
}

function updateTimeframeCards(payload: UIPayload) {
  const row = document.getElementById("tf-row")!;
  row.innerHTML = "";
  for (const tf of TIMEFRAMES) {
    const d = payload.timeframes[tf];
    const bias = d?.bias || "neutral";
    const card = document.createElement("div");
    card.className = `tf-card${tf === selectedTf ? " active" : ""}${bias === "bullish" ? " bullish" : bias === "bearish" ? " bearish" : ""}`;
    const cache = pipeline?.getState().candleCache.get(tf);
    const price = cache?.length ? cache[cache.length - 1].close.toFixed(2) : "---";
    card.innerHTML = `<span class="tf-label">${tf.toUpperCase()}</span><span class="tf-price">${price}</span>`;
    card.onclick = () => switchTimeframe(tf);
    row.appendChild(card);
  }
}

function updateMarquee(text: string) {
  document.getElementById("marquee-text")!.textContent = text;
}

function updateSignalSteps() {
  const c = document.getElementById("signal-steps")!;
  const s = pipeline?.getState().lastSignal;
  if (!s?.steps) { c.innerHTML = '<div class="step-card pending"><div class="step-num">?</div><div class="step-body"><div class="step-title">Đang phân tích...</div></div></div>'; return; }
  c.innerHTML = s.steps.map((st) => `<div class="step-card ${st.status}"><div class="step-num">${st.step}</div><div class="step-body"><div class="step-title">${st.title}</div><div class="step-desc">${st.description}</div></div></div>`).join("");
}

function updateConfidence() {
  const el = document.getElementById("confidence-value")!;
  const c = pipeline?.getState().lastSignal?.overallConfidence ?? 0;
  el.textContent = `${c}%`;
  el.style.color = c >= 70 ? "var(--green)" : c >= 50 ? "var(--gold)" : "var(--red)";
}

function updatePriceTag(price: number) {
  document.getElementById("current-price-tag")!.textContent = price ? price.toFixed(2) : "---";
}

function updateTrendlineTab(payload: UIPayload) {
  document.getElementById("tl-count")!.textContent = String(payload.trendlineCount);
  const c = document.getElementById("trendline-list")!;
  const all: Trendline[] = [];
  for (const r of pipeline.getState().timeframeResults.values()) {
    all.push(...(r as TimeframeAnalysisResult).trendlines.activeTrendlines);
  }
  if (!all.length) { c.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Chưa phát hiện đường xu hướng</div>'; return; }
  c.innerHTML = all.slice(0, 10).map((t) => {
    const sup = t.type === "ascending_support";
    return `<div class="tl-item"><div><div class="tl-type ${sup ? "support" : "resistance"}">${sup ? "▲ Hỗ trợ" : "▼ Kháng cự"}</div><div class="tl-info">Touch:${t.touches} ${t.lastInteraction} ${t.distanceToPricePercent.toFixed(1)}%</div></div><div class="tl-strength" style="color:${t.strength >= 60 ? "var(--green)" : "var(--gold)"}">${t.strength}</div></div>`;
  }).join("");
}

function updateChartAnnotations(payload: UIPayload) {
  const tf = pipeline?.getState().timeframeResults.get(selectedTf) as TimeframeAnalysisResult | undefined;
  const sig = pipeline?.getState().lastSignal;
  if (tf && chartCandleCache.length) {
    renderPatternMarkers(tf.patterns.patterns, chartCandleCache);
    renderTrendlines(tf.trendlines.activeTrendlines, chartCandleCache);
  }
  if (sig) renderEntryLines(sig);
}

// ── News ────────────────────────────────────────────────────
let newsLoaded = false;
function loadNewsIfNeeded() {
  if (newsLoaded) return;
  newsLoaded = true;
  const f = document.getElementById("news-filters")!;
  f.innerHTML = ["Tất cả","Bitcoin","Ethereum","Gold"].map((c, i) => `<button class="news-filter${i === 0 ? " active" : ""}">${c}</button>`).join("");
  f.onclick = (e) => { const b = (e.target as HTMLElement).closest(".news-filter"); if (!b) return; f.querySelectorAll(".news-filter").forEach(x => x.classList.remove("active")); b.classList.add("active"); };
  fetchNews();
}

async function fetchNews() {
  const l = document.getElementById("news-list")!;
  l.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Đang tải...</div>';
  try {
    const r = await fetch("https://min-api.cryptocompare.com/data/v2/news/?lang=EN&sortOrder=latest");
    const d = await r.json();
    const arts = (d.Data || []).slice(0, 6);
    if (!arts.length) { l.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Không có tin</div>'; return; }
    l.innerHTML = arts.map((a: any) => {
      const txt = (a.title + " " + (a.body || "")).toLowerCase();
      const pos = ["bull","surge","rally","gain","rise","growth","recover","pump","breakout"].filter(w => txt.includes(w)).length;
      const neg = ["bear","crash","drop","fall","decline","loss","dump","fear","risk","warn","plunge"].filter(w => txt.includes(w)).length;
      const t = pos + neg || 1;
      const sc = Math.round((pos / t) * 100);
      const cls = sc < 40 ? "negative" : sc > 60 ? "positive" : "neutral";
      const lb = sc < 40 ? "Tiêu cực" : sc > 60 ? "Tích cực" : "Trung tính";
      const desc = sc < 40 ? "Có thể gây áp lực giảm giá." : sc > 60 ? "Có thể hỗ trợ đà tăng." : "Tác động không rõ ràng.";
      const time = new Date(a.published_on * 1000).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
      return `<div class="news-card"><div class="news-source">${a.source_info?.name || a.source} · ${time}</div><div class="news-title">${a.title}</div><div class="news-sentiment ${cls}"><strong>Cảm xúc: ${lb} (${sc}%)</strong> - ${desc}</div></div>`;
    }).join("");
  } catch { l.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px">Lỗi tải tin tức</div>'; }
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
  s.value = currentSymbol;
  s.onchange = () => {
    const newSymbol = s.value;
    const newTfs = getTimeframes(newSymbol);
    if (!newTfs.includes(selectedTf)) {
      selectedTf = "1h";
    }
    newsLoaded = false;
    loadSymbol(newSymbol);
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
