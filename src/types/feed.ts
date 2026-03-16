export type RestWarmupState = "idle" | "loading" | "ok" | "error";
export type WebSocketState = "disconnected" | "connecting" | "connected" | "reconnecting" | "error";

export type AppPhase = "cold_start" | "warmup" | "live" | "stale" | "disconnected" | "error";

export type FeedHealth = {
  restWarmup: RestWarmupState;
  websocket: WebSocketState;
  reconnecting: boolean;
  lastPriceUpdateAt: number | null;
  lastFullAnalysisAt: number | null;
  lastRestSyncAt: number | null;
  stale: boolean;
  staleReason?: string;
  errorMessage?: string;
};

export type PerTimeframeHealth = {
  timeframe: string;
  lastCandleCloseAt: number | null;
  candleCount: number;
};

export function createInitialFeedHealth(): FeedHealth {
  return {
    restWarmup: "idle",
    websocket: "disconnected",
    reconnecting: false,
    lastPriceUpdateAt: null,
    lastFullAnalysisAt: null,
    lastRestSyncAt: null,
    stale: false,
  };
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000;

export function computeAppPhase(health: FeedHealth): AppPhase {
  if (health.restWarmup === "idle") return "cold_start";
  if (health.restWarmup === "loading") return "warmup";
  if (health.restWarmup === "error" && health.websocket === "error") return "error";
  if (health.websocket === "disconnected" && health.restWarmup === "ok") return "disconnected";
  if (health.stale) return "stale";
  if (health.restWarmup === "ok" && (health.websocket === "connected" || health.websocket === "connecting")) return "live";
  if (health.restWarmup === "ok") return "stale";
  return "warmup";
}

export function checkStale(health: FeedHealth, now: number): FeedHealth {
  const lastUpdate = health.lastPriceUpdateAt || health.lastRestSyncAt;
  if (lastUpdate && now - lastUpdate > STALE_THRESHOLD_MS) {
    return {
      ...health,
      stale: true,
      staleReason: `Không nhận được dữ liệu mới trong ${Math.round((now - lastUpdate) / 60000)} phút.`,
    };
  }
  return { ...health, stale: false, staleReason: undefined };
}
