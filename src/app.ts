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

    try {
      currentPrice = await feed.fetchPrice(symbol);
      healthService.recordPriceUpdate();
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
    if (width > 0 && height > 0) chart.resize(width, height);
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
  }
  add(signal.target, "#ffd700", LineStyle.Dotted, "Target");
  if (signal.direction !== "neutral") {
    add(signal.stopLoss, "#ff6d00", LineStyle.Dotted, "SL");
  }
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
    const series = chart.addSeries(LineSeries, {
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
      pipeline.setFeedHealth(healthService.getHealth());
      const payload = pipeline.runFullAnalysis(candle.close);
      healthService.recordFullAnalysis();
      lastPayload = payload;
      updateUI(payload);
      if (tf === selectedTf) { renderChartData(); updateChartAnnotations(payload); }
    } catch {}
  });

  healthService.setWebSocket("connecting");
  updateHealthIndicator();

  const subscribedSymbol = currentSymbol;
  feed.subscribe(subscribedSymbol, TIMEFRAMES, (sym, tf, candle, _isClose) => {
    if (sym.toUpperCase() !== subscribedSymbol.toUpperCase() &&
        candle.symbol?.toUpperCase() !== subscribedSymbol.toUpperCase()) {
      return;
    }

    const { closed } = candleManager.update(tf, candle);
    if (!closed) {
      pipeline.updateCandle(tf, candle);
      if (tf === selectedTf) updateChartCandle(candle);
      currentPrice = candle.close;
      healthService.recordPriceUpdate();
      updatePriceTag(candle.close);
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

function updateSignalBadge(dir: string, state: string) {
  const b = document.getElementById("signal-badge")!;
  if (state === "cooldown") { b.textContent = "Cooldown"; b.className = "badge badge-neutral"; }
  else if (state === "active_long") { b.textContent = "Active Long"; b.className = "badge badge-long"; }
  else if (state === "active_short") { b.textContent = "Active Short"; b.className = "badge badge-short"; }
  else if (state === "triggered_long") { b.textContent = "Triggered Long"; b.className = "badge badge-long"; }
  else if (state === "triggered_short") { b.textContent = "Triggered Short"; b.className = "badge badge-short"; }
  else if (state === "ready_long") { b.textContent = "Ready Long"; b.className = "badge badge-long"; }
  else if (state === "ready_short") { b.textContent = "Ready Short"; b.className = "badge badge-short"; }
  else if (dir === "long" || state.includes("long")) { b.textContent = "Theo dõi Long"; b.className = "badge badge-long"; }
  else if (dir === "short" || state.includes("short")) { b.textContent = "Theo dõi Short"; b.className = "badge badge-short"; }
  else { b.textContent = "Theo dõi"; b.className = "badge badge-neutral"; }
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
      const dominant = d.long >= d.short ? `L${d.long}` : `S${d.short}`;
      card.innerHTML = `<span class="tf-label">${tf.toUpperCase()}</span><span class="tf-price">${dominant}%</span>`;
    } else {
      card.className = `tf-card${tf === selectedTf ? " active" : ""}`;
      card.innerHTML = `<span class="tf-label">${tf.toUpperCase()}</span><span class="tf-price" style="color:var(--text3)">---</span>`;
    }
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
  document.getElementById("current-price-tag")!.textContent = price ? price.toFixed(2) : "---";
}

function updateTrendlineTab(payload: UIPayload) {
  const c = document.getElementById("trendline-list")!;
  const all: Trendline[] = [];
  for (const r of pipeline.getState().timeframeResults.values()) {
    all.push(...(r as TimeframeAnalysisResult).trendlines.activeTrendlines);
  }

  const deduped = dedupeTrendlines(all).slice(0, 5);
  document.getElementById("tl-count")!.textContent = String(deduped.length);

  if (!deduped.length) { c.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Chưa phát hiện đường xu hướng</div>'; return; }
  c.innerHTML = deduped.map((t) => {
    const sup = t.type === "ascending_support";
    const interLabel = t.lastInteraction !== "none" ? t.lastInteraction : "";
    return `<div class="tl-item"><div><div class="tl-type ${sup ? "support" : "resistance"}">${sup ? "▲ Hỗ trợ" : "▼ Kháng cự"}</div><div class="tl-info">Touch:${t.touches} ${interLabel} ${t.distanceToPricePercent.toFixed(1)}%</div></div><div class="tl-strength" style="color:${t.strength >= 60 ? "var(--green)" : "var(--gold)"}">${t.strength}</div></div>`;
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

function updateChartAnnotations(payload: UIPayload) {
  const tf = pipeline?.getState().timeframeResults.get(selectedTf) as TimeframeAnalysisResult | undefined;
  const sig = pipeline?.getState().lastSignal;
  if (tf && chartCandleCache.length) {
    renderPatternMarkers(tf.patterns.patterns, chartCandleCache);
    renderTrendlines(tf.trendlines.activeTrendlines, chartCandleCache);
  }
  if (sig) renderEntryLines(sig);
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
function loadNewsIfNeeded() {
  if (newsLoaded) return;
  newsLoaded = true;
  const f = document.getElementById("news-filters")!;
  f.innerHTML = ["Tất cả","Bitcoin","Ethereum","Vàng/PAXG"].map((c, i) => `<button class="news-filter${i === 0 ? " active" : ""}">${c}</button>`).join("");
  f.onclick = (e) => { const b = (e.target as HTMLElement).closest(".news-filter"); if (!b) return; f.querySelectorAll(".news-filter").forEach(x => x.classList.remove("active")); b.classList.add("active"); };
  renderNewsFromPayload();
}

function renderNewsFromPayload() {
  const l = document.getElementById("news-list")!;
  const news = lastPayload?.news || newsService?.getCachedNews() || [];
  if (!news.length) {
    l.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:12px">Không có tin tức</div>';
    return;
  }
  l.innerHTML = news.map((n) => {
    const cls = n.sentiment === "negative" ? "negative" : n.sentiment === "positive" ? "positive" : "neutral";
    const lb = n.sentiment === "negative" ? "Tiêu cực" : n.sentiment === "positive" ? "Tích cực" : "Trung tính";
    const desc = n.sentiment === "negative" ? "Có thể gây áp lực giảm giá." : n.sentiment === "positive" ? "Có thể hỗ trợ đà tăng." : "Tác động không rõ ràng.";
    const time = new Date(n.publishedAt).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
    const impactBadge = n.impact === "high" ? " 🔴" : n.impact === "medium" ? " 🟡" : "";
    return `<div class="news-card"><div class="news-source">${n.source} · ${time}${impactBadge}</div><div class="news-title">${n.title}</div><div class="news-sentiment ${cls}"><strong>Cảm xúc: ${lb} (${n.confidence}%)</strong> - ${desc}</div></div>`;
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
