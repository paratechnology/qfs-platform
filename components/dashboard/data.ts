/* Reference data for the QFS dashboard (lists/currencies/pricings the UI
   needs that the live API also serves where available). No mock user,
   balances, transactions or reviews — those now come from the API only. */

export const METALS = [
  { sym: "XAU", name: "Gold", full: "Gold / USD", price: "2,394.50", chg: "+0.82%", up: true },
  { sym: "XAG", name: "Silver", full: "Silver / USD", price: "28.94", chg: "+1.14%", up: true },
  { sym: "XPT", name: "Platinum", full: "Platinum / USD", price: "1,012.00", chg: "-0.31%", up: false },
  { sym: "XPD", name: "Palladium", full: "Palladium / USD", price: "1,089.40", chg: "+0.42%", up: true },
  { sym: "XCU", name: "Copper", full: "Copper / USD", price: "4.521", chg: "+0.63%", up: true },
];

export const STOCKS = [
  { sym: "SPX", name: "S&P 500", full: "Index", price: "5,428.12", chg: "+0.41%", up: true },
  { sym: "IXIC", name: "NASDAQ", full: "Index", price: "17,612.50", chg: "+0.72%", up: true },
  { sym: "DJI", name: "Dow Jones", full: "Index", price: "39,218.34", chg: "-0.12%", up: false },
  { sym: "AAPL", name: "Apple Inc.", full: "Technology", price: "214.29", chg: "+1.22%", up: true },
  { sym: "TSLA", name: "Tesla Inc.", full: "Automotive", price: "248.50", chg: "+2.01%", up: true },
  { sym: "NVDA", name: "NVIDIA Corp.", full: "Semiconductors", price: "131.20", chg: "+1.85%", up: true },
  { sym: "MSFT", name: "Microsoft", full: "Technology", price: "448.10", chg: "+0.34%", up: true },
  { sym: "AMZN", name: "Amazon.com", full: "E-commerce", price: "186.44", chg: "-0.52%", up: false },
];

export const CRYPTO = [
  { sym: "BTC", name: "Bitcoin", full: "BTC / USD", price: "64,280", chg: "+2.4%", up: true },
  { sym: "ETH", name: "Ethereum", full: "ETH / USD", price: "3,412", chg: "+1.8%", up: true },
  { sym: "XRP", name: "XRP", full: "XRP / USD", price: "0.5234", chg: "+0.9%", up: true },
  { sym: "SOL", name: "Solana", full: "SOL / USD", price: "148.20", chg: "+3.1%", up: true },
  { sym: "DOGE", name: "Dogecoin", full: "DOGE / USD", price: "0.124", chg: "+4.2%", up: true },
  { sym: "ADA", name: "Cardano", full: "ADA / USD", price: "0.449", chg: "+1.2%", up: true },
  { sym: "LTC", name: "Litecoin", full: "LTC / USD", price: "84.90", chg: "+0.6%", up: true },
  { sym: "BNB", name: "BNB", full: "BNB / USD", price: "587.00", chg: "+0.4%", up: true },
];

export const DOCUMENTS = [
  { code: "en-us", label: "English Presentation", flag: "/dashboard/flags/en-us.svg" },
  { code: "fr", label: "French Presentation", flag: "/dashboard/flags/fr.svg" },
  { code: "pt", label: "Portuguese Presentation", flag: "/dashboard/flags/pt.svg" },
  { code: "ar", label: "Arabic Presentation", flag: "/dashboard/flags/ar.svg" },
  { code: "es", label: "Spanish Presentation", flag: "/dashboard/flags/es.svg" },
  { code: "fa", label: "Persian Presentation", flag: "/dashboard/flags/fa.svg" },
  { code: "vi", label: "Vietnamese Presentation", flag: "/dashboard/flags/vi.svg" },
  { code: "hi", label: "Hindi Presentation", flag: "/dashboard/flags/hi.svg" },
  { code: "be", label: "Bengali Presentation", flag: "/dashboard/flags/be.png" },
  { code: "id", label: "Indonesian Presentation", flag: "/dashboard/flags/id.svg" },
  { code: "tr", label: "Turkish Presentation", flag: "/dashboard/flags/tr.svg" },
  { code: "ur", label: "Urdu Presentation", flag: "/dashboard/flags/ur.svg" },
  { code: "th", label: "Thai Presentation", flag: "/dashboard/flags/th.svg" },
  { code: "tl", label: "Filipino Presentation", flag: "/dashboard/flags/tl.svg" },
  { code: "ku", label: "Kurdish Presentation", flag: "/dashboard/flags/ku.svg" },
];

export const REVIEW_RATINGS = [
  { stars: 5, pct: 88 },
  { stars: 4, pct: 10 },
  { stars: 3, pct: 2 },
];

export const LOAN_TYPES = [
  "Personal Loans",
  "Student Loans",
  "Agricultural Loans",
  "Auto Loans",
  "Mortgage Loans",
  "Business Loans",
  "Payday Loans",
  "Crypto Merchant Loans",
  "Stablecoin Loans",
  "NFT Loans",
  "Debt Consolidation Loans",
  "Home Equity Loans",
  "Medical Loans",
  "Energy-efficient Loans",
];

export const LOAN_PERIODS = [
  "3",
  "6",
  "12",
  "24",
];

export const LOAN_CURRENCIES = [
  "BTC",
  "ETH",
  "LTC",
  "USDT (ERC20)",
  "USDT (TRC20)",
  "BNB",
  "DOGE",
  "XRP",
  "XLM",
  "ADA",
  "QNT",
];

export const MARKET_COLORS: Record<string, string> = {
  BTC: "#F7931A",
  ETH: "#627EEA",
  XRP: "#23292F",
  SOL: "#9945FF",
  DOGE: "#C2A633",
  ADA: "#0033AD",
  LTC: "#345D9D",
  BNB: "#F0B90B",
  XAU: "#D4AF37",
  XAG: "#9EA7B3",
  XPT: "#A6B9C8",
  XPD: "#B3665C",
  XCU: "#B87333",
  SPX: "#4DA3FF",
  IXIC: "#4DA3FF",
  DJI: "#4DA3FF",
  AAPL: "#A2AAAD",
  TSLA: "#E82127",
  NVDA: "#76B900",
  MSFT: "#00A4EF",
  AMZN: "#FF9900",
};

export const INVESTMENT_PLANS = [
  { name: "QFS Starter", min: "$100", max: "$49,999", roi: "10% monthly", term: "3 months", payoutInterval: "HOURLY" as const },
  { name: "QFS Growth", min: "$50,000", max: "$499,999", roi: "25% monthly", term: "6 months", payoutInterval: "HOURLY" as const },
  { name: "QFS Premium", min: "$500,000", max: "$1,000,000", roi: "35% monthly", term: "12 months", payoutInterval: "HOURLY" as const },
];
