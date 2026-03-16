import {
  FeedHealth,
  RestWarmupState,
  WebSocketState,
  AppPhase,
  createInitialFeedHealth,
  computeAppPhase,
  checkStale,
  PerTimeframeHealth,
} from "../types/feed";

export class FeedHealthService {
  private health: FeedHealth;
  private perTimeframe: Map<string, PerTimeframeHealth> = new Map();

  constructor() {
    this.health = createInitialFeedHealth();
  }

  getHealth(): FeedHealth {
    return checkStale({ ...this.health }, Date.now());
  }

  getPhase(): AppPhase {
    return computeAppPhase(this.getHealth());
  }

  setRestWarmup(state: RestWarmupState, errorMessage?: string): void {
    this.health.restWarmup = state;
    if (state === "ok") {
      this.health.lastRestSyncAt = Date.now();
      this.health.errorMessage = undefined;
    }
    if (state === "error" && errorMessage) {
      this.health.errorMessage = errorMessage;
    }
  }

  setWebSocket(state: WebSocketState): void {
    this.health.websocket = state;
    this.health.reconnecting = state === "reconnecting";
    if (state === "connected") {
      this.health.reconnecting = false;
    }
  }

  recordPriceUpdate(): void {
    this.health.lastPriceUpdateAt = Date.now();
  }

  recordFullAnalysis(): void {
    this.health.lastFullAnalysisAt = Date.now();
  }

  recordTimeframeCandleClose(timeframe: string, candleCount: number): void {
    this.perTimeframe.set(timeframe, {
      timeframe,
      lastCandleCloseAt: Date.now(),
      candleCount,
    });
  }

  getPerTimeframeHealth(): PerTimeframeHealth[] {
    return Array.from(this.perTimeframe.values());
  }

  getLoadedTimeframeCount(): number {
    return this.perTimeframe.size;
  }

  setError(message: string): void {
    this.health.errorMessage = message;
  }

  clearError(): void {
    this.health.errorMessage = undefined;
  }
}
