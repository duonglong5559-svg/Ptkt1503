export type SupportedSymbol = "BTCUSDT" | "ETHUSDT" | "PAXGUSDT";

export type AssetClass = "crypto" | "gold_proxy";

export type SymbolDescriptor = {
  symbol: SupportedSymbol;
  display: string;
  displayLabel: string;
  asset: "BTC" | "ETH" | "PAXG";
  category: AssetClass;
};

export const SUPPORTED_SYMBOLS: SupportedSymbol[] = [
  "BTCUSDT",
  "ETHUSDT",
  "PAXGUSDT",
];

export const ANALYSIS_TIMEFRAMES = [
  "15m", "1h", "2h", "4h", "6h", "8h", "12h", "1d", "1w",
] as const;

export type AnalysisTimeframe = (typeof ANALYSIS_TIMEFRAMES)[number];

export const TIMEFRAME_ROLES: Record<AnalysisTimeframe, string> = {
  "15m": "timing",
  "1h": "timing",
  "2h": "directional",
  "4h": "directional",
  "6h": "directional",
  "8h": "directional",
  "12h": "macro",
  "1d": "macro",
  "1w": "macro",
};
