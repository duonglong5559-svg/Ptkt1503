import { SupportedSymbol, SymbolDescriptor, SUPPORTED_SYMBOLS } from "../types/symbol";

const SYMBOL_MAP: Record<SupportedSymbol, SymbolDescriptor> = {
  BTCUSDT: {
    symbol: "BTCUSDT",
    display: "BTC/USDT",
    displayLabel: "BTC/USDT",
    asset: "BTC",
    category: "crypto",
  },
  ETHUSDT: {
    symbol: "ETHUSDT",
    display: "ETH/USDT",
    displayLabel: "ETH/USDT",
    asset: "ETH",
    category: "crypto",
  },
  PAXGUSDT: {
    symbol: "PAXGUSDT",
    display: "PAXG/USDT",
    displayLabel: "PAXG/USDT - Vàng",
    asset: "PAXG",
    category: "gold_proxy",
  },
};

export class SymbolMapping {
  static get(symbol: string): SymbolDescriptor | undefined {
    return SYMBOL_MAP[symbol.toUpperCase() as SupportedSymbol];
  }

  static getDisplay(symbol: string): string {
    return SYMBOL_MAP[symbol.toUpperCase() as SupportedSymbol]?.display || symbol;
  }

  static getDisplayLabel(symbol: string): string {
    return SYMBOL_MAP[symbol.toUpperCase() as SupportedSymbol]?.displayLabel || symbol;
  }

  static getAsset(symbol: string): string {
    return SYMBOL_MAP[symbol.toUpperCase() as SupportedSymbol]?.asset || symbol;
  }

  static isSupported(symbol: string): boolean {
    return SUPPORTED_SYMBOLS.includes(symbol.toUpperCase() as SupportedSymbol);
  }

  static all(): SymbolDescriptor[] {
    return SUPPORTED_SYMBOLS.map((s) => SYMBOL_MAP[s]);
  }
}
