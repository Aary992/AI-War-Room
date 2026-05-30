import { NextResponse } from "next/server";

type RiskLevel = "safe" | "balanced" | "aggressive";
type Horizon = "short" | "medium" | "long";
type Bucket = "Core" | "Growth" | "Speculative";

type AllocationInput = {
  capital: number;
  riskLevel: RiskLevel;
  horizon: Horizon;
  cashReservePercent: number;
  maxPositionPercent: number;
  trancheCount: number;
  tickers: string[];
};

type YahooQuote = {
  symbol: string;
  shortName?: string;
  longName?: string;
  regularMarketPrice?: number;
  currency?: string;
  marketCap?: number;
  beta?: number;
  fiftyDayAverage?: number;
  twoHundredDayAverage?: number;
  trailingPE?: number;
  epsTrailingTwelveMonths?: number;
  targetMeanPrice?: number;
};

type ChartMeta = {
  currency?: string;
  symbol?: string;
  regularMarketPrice?: number;
  regularMarketVolume?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  longName?: string;
  shortName?: string;
};

type QuoteResult = {
  trailingPE?: number;
  forwardPE?: number;
  marketCap?: number;
  quoteType?: string;
};

type StockProfile = {
  requestedTicker: string;
  symbol: string;
  name: string;
  sector: string;
  price: number;
  currency: string;
  marketCap: number | null;
  dailyTurnover: number | null;
  beta: number | null;
  annualVolatility: number | null;
  fairValue: number;
  fiftyTwoWeekHigh: number | null;
  fiftyTwoWeekLow: number | null;
  currentPE: number | null;
  fiveYearAveragePE: number | null;
  bucket: Bucket;
};

const RISK_BUCKET_WEIGHTS: Record<RiskLevel, Record<Bucket, number>> = {
  safe: { Core: 0.7, Growth: 0.25, Speculative: 0.05 },
  balanced: { Core: 0.5, Growth: 0.35, Speculative: 0.15 },
  aggressive: { Core: 0.3, Growth: 0.4, Speculative: 0.3 }
};

const INR_FORMATTER = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const LARGE_CAP_TICKERS = new Set([
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "BHARTIARTL",
  "ICICIBANK",
  "INFY",
  "SBIN",
  "LICI",
  "ITC",
  "HINDUNILVR",
  "LT",
  "BAJFINANCE",
  "KOTAKBANK",
  "AXISBANK",
  "HCLTECH",
  "MARUTI",
  "SUNPHARMA",
  "M&M",
  "ULTRACEMCO",
  "NTPC",
  "ONGC",
  "TITAN",
  "POWERGRID",
  "ASIANPAINT",
  "NESTLEIND"
]);

const QUALITY_MID_CAP_TICKERS = new Set([
  "DMART",
  "TRENT",
  "PIDILITIND",
  "ABB",
  "SIEMENS",
  "INDIGO",
  "NAUKRI",
  "DIVISLAB",
  "DIXON",
  "LTIM",
  "PERSISTENT",
  "POLYCAB",
  "GODREJCP",
  "BRITANNIA",
  "EICHERMOT"
]);

const PE_ANCHORS: Record<string, number> = {
  RELIANCE: 24,
  TCS: 28,
  INFY: 25,
  HDFCBANK: 20,
  ICICIBANK: 19,
  LT: 30,
  TITAN: 75,
  DMART: 95,
  TRENT: 95,
  DIXON: 85,
  ITC: 25,
  SBIN: 12,
  AXISBANK: 15,
  BHARTIARTL: 55,
  HCLTECH: 24,
  WIPRO: 22,
  KOTAKBANK: 25
};

const SECTOR_MAP: Record<string, string> = {
  TCS: "IT services",
  INFY: "IT services",
  HCLTECH: "IT services",
  WIPRO: "IT services",
  RELIANCE: "Energy, retail, telecom",
  HDFCBANK: "Banking",
  ICICIBANK: "Banking",
  AXISBANK: "Banking",
  KOTAKBANK: "Banking",
  SBIN: "Banking",
  LT: "Engineering and infrastructure",
  TITAN: "Jewellery and lifestyle retail",
  DMART: "Grocery retail",
  TRENT: "Fashion retail",
  DIXON: "Electronics manufacturing",
  ITC: "Consumer goods and hotels",
  BHARTIARTL: "Telecom",
  IDEA: "Telecom",
  E2E: "Cloud infrastructure and data centres",
  MARUTI: "Automobiles",
  SUNPHARMA: "Pharmaceuticals"
};

const COMPANY_NAME_OVERRIDES: Record<string, string> = {
  IDEA: "Vodafone Idea",
  E2E: "E2E Networks"
};

function isRiskLevel(value: unknown): value is RiskLevel {
  return value === "safe" || value === "balanced" || value === "aggressive";
}

function isHorizon(value: unknown): value is Horizon {
  return value === "short" || value === "medium" || value === "long";
}

function cleanTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace(/\s+/g, "");
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function baseTicker(symbol: string) {
  return cleanTicker(symbol).replace(/\.(NS|BO)$/i, "");
}

function tickerCandidates(ticker: string) {
  const cleaned = cleanTicker(ticker);
  if (!cleaned) return [];
  if (cleaned.includes(".") || cleaned.includes("-")) return [cleaned];
  return [`${cleaned}.NS`, `${cleaned}.BO`, cleaned];
}

function calculateAnnualVolatility(prices: number[]) {
  if (prices.length < 20) return null;

  const returns = prices
    .slice(1)
    .map((price, index) => Math.log(price / prices[index]))
    .filter(Number.isFinite);

  if (!returns.length) return null;

  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) /
    Math.max(returns.length - 1, 1);

  return Math.sqrt(variance) * Math.sqrt(252);
}

function movingAverage(prices: number[], period: number) {
  const sample = prices.slice(-period);
  if (!sample.length) return null;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

async function fetchChartProfile(symbol: string) {
  const url = new URL(`https://query1.finance.yahoo.com/v8/finance/chart/${symbol}`);
  url.searchParams.set("range", "1y");
  url.searchParams.set("interval", "1d");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 WarRoomAllocator/1.0"
    },
    next: { revalidate: 3600 }
  });

  if (!response.ok) return null;

  const data = await response.json();
  const result = data?.chart?.result?.[0];
  if (!result) return null;

  const meta = (result.meta ?? {}) as ChartMeta;
  const closes: Array<number | null> =
    result?.indicators?.quote?.[0]?.close ?? [];
  const prices = closes.filter((price): price is number => typeof price === "number" && price > 0);

  if (!prices.length || !meta.regularMarketPrice) return null;

  return {
    meta,
    prices,
    annualVolatility: calculateAnnualVolatility(prices),
    fiftyDayAverage: movingAverage(prices, 50),
    twoHundredDayAverage: movingAverage(prices, 200)
  };
}

async function fetchQuoteProfile(symbol: string) {
  const url = new URL("https://query1.finance.yahoo.com/v7/finance/quote");
  url.searchParams.set("symbols", symbol);

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 WarRoomAllocator/1.0"
    },
    next: { revalidate: 3600 }
  });

  if (!response.ok) return null;

  const data = await response.json();
  return (data?.quoteResponse?.result?.[0] ?? null) as QuoteResult | null;
}

function estimateFairValue({
  price,
  fiftyDayAverage,
  twoHundredDayAverage,
  fiftyTwoWeekHigh,
  fiftyTwoWeekLow,
  volatility
}: {
  price: number;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  volatility: number | null;
}) {
  const rangeMidpoint =
    typeof fiftyTwoWeekHigh === "number" && typeof fiftyTwoWeekLow === "number"
      ? (fiftyTwoWeekHigh + fiftyTwoWeekLow) / 2
      : null;

  const anchors = [
    price,
    fiftyDayAverage,
    twoHundredDayAverage,
    rangeMidpoint
  ].filter((value): value is number => typeof value === "number" && value > 0);

  const base = anchors.length
    ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length
    : price;

  if (!volatility) return base;
  if (volatility > 0.75) return base * 0.9;
  if (volatility > 0.55) return base * 0.95;
  if (volatility < 0.28) return base * 1.03;
  return base;
}

function classifyBucket(profile: Omit<StockProfile, "bucket">): Bucket {
  const ticker = baseTicker(profile.symbol);
  const volatility = profile.annualVolatility ?? 0.5;
  const dailyTurnover = profile.dailyTurnover ?? 0;

  if (LARGE_CAP_TICKERS.has(ticker) && volatility <= 0.55) {
    return "Core";
  }

  if (
    QUALITY_MID_CAP_TICKERS.has(ticker) ||
    (dailyTurnover >= 1_000_000_000 && volatility <= 0.72)
  ) {
    return "Growth";
  }

  return "Speculative";
}

function profileQuality(profile: StockProfile) {
  const capScore = profile.dailyTurnover
    ? Math.log10(Math.max(profile.dailyTurnover, 1)) / 10
    : LARGE_CAP_TICKERS.has(baseTicker(profile.symbol))
      ? 0.95
      : 0.45;
  const volPenalty = profile.annualVolatility ? Math.min(profile.annualVolatility, 1.2) : 0.55;
  const betaPenalty = profile.beta ? Math.min(Math.abs(profile.beta - 1), 1.1) : 0.35;
  return Math.max(0.18, capScore * 1.1 - volPenalty * 0.55 - betaPenalty * 0.18);
}

function confidenceFor(profile: StockProfile): "High" | "Medium" | "Low" {
  const volatility = profile.annualVolatility ?? 0.6;
  const hasKnownQuality =
    LARGE_CAP_TICKERS.has(baseTicker(profile.symbol)) ||
    QUALITY_MID_CAP_TICKERS.has(baseTicker(profile.symbol));

  if (hasKnownQuality && volatility <= 0.45) return "High";
  if (profile.dailyTurnover && profile.dailyTurnover > 750_000_000 && volatility <= 0.7) {
    return "Medium";
  }
  return "Low";
}

function riskTagFor(profile: StockProfile) {
  const volatility = profile.annualVolatility ?? 0.6;
  if (profile.bucket === "Core") return "Large, liquid, lower-volatility anchor";
  if (profile.bucket === "Growth" && volatility <= 0.65) return "Quality growth with moderate swings";
  if (profile.bucket === "Growth") return "Growth name with elevated price swings";
  return "Higher-volatility position, sized deliberately smaller";
}

function rationaleFor(profile: StockProfile) {
  const volatility = profile.annualVolatility
    ? `${Math.round(profile.annualVolatility * 100)}% annual volatility`
    : "limited volatility data";
  const liquidity = profile.dailyTurnover && profile.dailyTurnover > 1_000_000_000
    ? "strong liquidity"
    : "lighter liquidity";

  return `${riskTagFor(profile)} based on ${liquidity} and ${volatility}.`;
}

function fallFromHigh(profile: StockProfile) {
  if (!profile.fiftyTwoWeekHigh || profile.fiftyTwoWeekHigh <= 0) return null;
  return Math.max(0, ((profile.fiftyTwoWeekHigh - profile.price) / profile.fiftyTwoWeekHigh) * 100);
}

function distanceFromLow(profile: StockProfile) {
  if (!profile.fiftyTwoWeekLow || profile.fiftyTwoWeekLow <= 0) return null;
  return Math.max(0, ((profile.price - profile.fiftyTwoWeekLow) / profile.fiftyTwoWeekLow) * 100);
}

function buySignalFor(profile: StockProfile): {
  label: string;
  tone: "green" | "yellow" | "red";
  detail: string;
  reason: string;
} {
  const fall = fallFromHigh(profile) ?? 0;
  const lowDistance = distanceFromLow(profile) ?? 100;

  if (lowDistance <= 15) {
    return {
      label: "\u{1F7E2} Strong Buy Zone",
      tone: "green",
      detail: `${profile.requestedTicker} is ${lowDistance.toFixed(0)}% above its 52 week low.`,
      reason: `${profile.requestedTicker} is only ${lowDistance.toFixed(0)}% above its 52 week low in ${profile.sector}.`
    };
  }

  if (fall > 20 && lowDistance > 10) {
    return {
      label: "\u{1F7E1} Good Entry \u2014 Buy In Parts",
      tone: "yellow",
      detail: `${profile.requestedTicker} is ${fall.toFixed(0)}% below its 52 week high.`,
      reason: `${profile.requestedTicker} is ${fall.toFixed(0)}% below its 52 week high, but not near yearly lows yet.`
    };
  }

  if (fall <= 10) {
    return {
      label: "\u{1F534} Too Expensive \u2014 Wait For A Dip",
      tone: "red",
      detail: `${profile.requestedTicker} is within 10% of its 52 week high.`,
      reason: `${profile.requestedTicker} is close to its 52 week high, so entry risk is higher.`
    };
  }

  return {
    label: "\u{1F7E1} Good Entry \u2014 Buy In Parts",
    tone: "yellow",
    detail: `${profile.requestedTicker} has cooled from highs but is not deeply cheap.`,
    reason: `${profile.requestedTicker} has cooled from its high, but is not deeply cheap yet.`
  };
}

function calculateBuyBelowPrice(profile: StockProfile, allocationAmount: number) {
  const low = profile.fiftyTwoWeekLow ?? profile.price * 0.85;
  const fall = fallFromHigh(profile) ?? 0;
  const midpointMinusFive = ((low + profile.price) / 2) * 0.95;
  const maxDiscountFloor = fall > 40 ? low : profile.price * 0.7;
  const affordableCap = allocationAmount >= profile.price ? allocationAmount : profile.price;
  return Number(Math.min(Math.max(midpointMinusFive, low, maxDiscountFloor), profile.price, affordableCap).toFixed(2));
}

function marketCapLabel(profile: StockProfile) {
  if (!profile.marketCap) return "market-cap data is limited";
  if (profile.marketCap >= 5_000_000_000_000) return "mega-cap scale";
  if (profile.marketCap >= 1_000_000_000_000) return "large-cap scale";
  if (profile.marketCap >= 250_000_000_000) return "mid-cap scale";
  return "smaller market-cap scale";
}

function whyBucket(profile: StockProfile) {
  const volatility = profile.annualVolatility ? `${Math.round(profile.annualVolatility * 100)}% annual volatility` : "limited volatility history";
  if (profile.bucket === "Core") {
    return `${profile.name} is placed in Core because it has ${marketCapLabel(profile)}, a steadier ${profile.sector} business, and ${volatility}.`;
  }
  if (profile.bucket === "Growth") {
    return `${profile.name} is placed in Growth because its ${profile.sector} profile offers upside, with ${marketCapLabel(profile)} and ${volatility}.`;
  }
  return `${profile.name} is placed in Speculative because its ${profile.sector} exposure and ${volatility} make position sizing more important.`;
}

function whyAllocation(profile: StockProfile, riskLevel: RiskLevel, allocationPercent: number) {
  return `${allocationPercent.toFixed(1)}% was chosen because the ${riskLevel} profile weights ${profile.bucket} stocks this way after adjusting for ${profile.name}'s liquidity and volatility.`;
}

function whyBuyBelow(profile: StockProfile, buyBelowPrice: number) {
  return `${INR_FORMATTER.format(buyBelowPrice)} is the better entry zone: below today's price, but not so low that the order is unrealistic.`;
}

function confidenceScore(profile: StockProfile, signalTone: "green" | "yellow" | "red") {
  const lowDistance = distanceFromLow(profile) ?? 60;
  const peGap =
    profile.currentPE && profile.fiveYearAveragePE
      ? ((profile.fiveYearAveragePE - profile.currentPE) / profile.fiveYearAveragePE) * 100
      : 0;
  let score = profile.bucket === "Core" ? 5 : profile.bucket === "Growth" ? 4 : 3;
  if (lowDistance <= 10) score += 2;
  else if (lowDistance <= 20) score += 1;
  if (peGap > 15) score += 1;
  if (signalTone === "green") score += 2;
  if (signalTone === "yellow") score += 1;
  if (signalTone === "red") score -= 2;
  return Math.round(clamp(score, 1, 10));
}

function confidenceExplanation(profile: StockProfile, score: number) {
  const lowDistance = distanceFromLow(profile);
  return `Conviction is ${score}/10 because ${profile.name} is ${lowDistance !== null ? `${lowDistance.toFixed(0)}% above its 52 week low` : "missing complete 52 week low data"} in ${profile.sector}.`;
}

function confidenceUpside(profile: StockProfile) {
  return `The score would improve if ${profile.name} moves closer to its 52 week low while earnings and sector data stay stable.`;
}

function riskBulletsFor(profile: StockProfile) {
  const ticker = baseTicker(profile.symbol);
  const company = profile.name || profile.requestedTicker;
  const sector = profile.sector.toLowerCase();
  const stockRisks: Record<string, string[]> = {
    TCS: [
      "TCS depends heavily on US technology spending.",
      "Banking clients may delay large software projects.",
      "AI automation can pressure outsourcing deal sizes."
    ],
    INFY: [
      "Infosys growth slows when global tech budgets tighten.",
      "Large deal delays can hurt Infosys revenue visibility.",
      "Margin pressure rises if wage costs climb."
    ],
    RELIANCE: [
      "Reliance earnings depend on oil, retail, and telecom cycles.",
      "High debt-funded expansion can worry investors.",
      "Oil weakness can drag refining profits lower."
    ],
    HDFCBANK: [
      "HDFC Bank loan growth can slow in weak markets.",
      "Deposit costs may pressure bank profits.",
      "Merger integration issues can weigh on returns."
    ],
    ICICIBANK: [
      "ICICI Bank profits depend on credit quality staying strong.",
      "Bad loans can rise if borrowers struggle.",
      "Deposit competition can reduce lending margins."
    ],
    LT: [
      "Larsen projects can suffer from execution delays.",
      "Government spending cuts can slow order growth.",
      "Infrastructure costs can rise faster than expected."
    ],
    TITAN: [
      "Titan sales can slow if gold prices jump.",
      "Jewellery demand weakens when consumers cut spending.",
      "Premium valuation leaves little room for disappointment."
    ],
    DMART: [
      "DMart store growth can slow in crowded cities.",
      "Low margins leave little room for mistakes.",
      "Online grocery competition can pressure footfall."
    ],
    TRENT: [
      "Trent valuation depends on fast store expansion.",
      "Fashion demand can change quickly.",
      "Any slowdown in Zudio growth can hurt sentiment."
    ],
    DIXON: [
      "Dixon depends on electronics manufacturing demand.",
      "Client losses can quickly hit factory utilisation.",
      "Government incentive changes can affect profits."
    ],
    IDEA: [
      "Vodafone Idea's telecom business depends on raising tariffs enough to fund 4G and 5G network upgrades.",
      "Vodafone Idea carries heavy debt and AGR dues that can limit shareholder upside.",
      "Vodafone Idea can lose subscribers if Jio and Airtel keep stronger network coverage in key circles."
    ],
    E2E: [
      "E2E Networks depends on GPU cloud and data-centre capacity being filled by AI customers.",
      "E2E Networks can be hurt if Nvidia GPU supply, power costs, or data-centre capex become unfavourable.",
      "E2E Networks faces concentration risk if large cloud customers shift workloads to hyperscalers."
    ],
    HCLTECH: [
      "HCLTech depends on large enterprise technology transformation budgets.",
      "HCLTech's software segment can slow when clients delay renewals.",
      "A stronger rupee can pressure HCLTech's export margins."
    ],
    WIPRO: [
      "Wipro relies on global IT services spending recovering.",
      "Wipro can lose momentum if large transformation deals are delayed.",
      "Wipro's margins can stay under pressure during restructuring phases."
    ],
    SBIN: [
      "State Bank of India earnings depend on loan growth across public-sector banking.",
      "SBI can be hit if corporate or retail bad loans rise.",
      "SBI's margins can compress when deposit costs move up faster than lending yields."
    ],
    AXISBANK: [
      "Axis Bank profitability depends on retail and corporate credit quality.",
      "Axis Bank can face margin pressure from intense deposit competition.",
      "Axis Bank sentiment can weaken if unsecured loan stress rises."
    ],
    KOTAKBANK: [
      "Kotak Mahindra Bank depends on steady high-quality loan growth.",
      "Kotak Bank can lag if deposit growth stays expensive.",
      "Leadership or regulatory uncertainty can weigh on Kotak Bank's valuation."
    ],
    BHARTIARTL: [
      "Bharti Airtel earnings depend on tariff hikes and subscriber quality.",
      "Bharti Airtel carries telecom network investment and spectrum cost pressure.",
      "Price competition from Jio can limit Airtel's margin expansion."
    ],
    MARUTI: [
      "Maruti Suzuki depends on Indian passenger vehicle demand staying strong.",
      "Maruti margins can shrink if commodity or currency costs rise.",
      "EV transition risk can pressure Maruti if consumer preferences shift faster than expected."
    ],
    SUNPHARMA: [
      "Sun Pharma faces US FDA and plant compliance risk.",
      "Sun Pharma's specialty drug pipeline must keep scaling to support premium valuation.",
      "Generic drug pricing pressure can drag Sun Pharma's export profitability."
    ],
    ITC: [
      "ITC still depends heavily on cigarette cash flows.",
      "ITC faces taxation and regulation risk in tobacco.",
      "ITC's FMCG and hotel businesses need steady execution to justify higher valuation."
    ]
  };

  if (stockRisks[ticker]) return stockRisks[ticker];

  if (sector.includes("bank")) {
    return [
      `${company} depends on credit quality staying strong in its banking book.`,
      `${company} can see profits squeezed if deposit costs rise faster than lending yields.`,
      `${company} may fall if bad-loan stress appears in its retail or corporate borrowers.`
    ];
  }

  if (sector.includes("it")) {
    return [
      `${company} depends on overseas technology budgets and large deal wins.`,
      `${company} can slow if US or European clients delay digital transformation spending.`,
      `${company} margins can weaken if wage costs or currency moves pressure IT services exports.`
    ];
  }

  if (sector.includes("retail")) {
    return [
      `${company} depends on store expansion, footfall, and same-store sales growth.`,
      `${company} can be hurt if consumer spending weakens in its retail categories.`,
      `${company} valuation risk rises if expansion slows or operating margins compress.`
    ];
  }

  if (sector.includes("pharma")) {
    return [
      `${company} faces product approval, pricing, and compliance risk in pharmaceuticals.`,
      `${company} can be hurt by US generic pricing pressure or regulatory observations.`,
      `${company} needs a healthy drug pipeline to protect earnings growth.`
    ];
  }

  if (profile.bucket === "Core") {
    return [
      `${company} still depends on steady execution in ${profile.sector}.`,
      `${company} can underperform if its ${profile.sector} earnings cycle weakens.`,
      `${company} may move slowly if investors prefer faster-growing sectors.`
    ];
  }

  if (profile.bucket === "Growth") {
    return [
      `${company} needs strong ${profile.sector} growth to justify its valuation.`,
      `${company} can fall sharply if quarterly growth disappoints investors.`,
      `${company} may struggle if demand in ${profile.sector} slows.`
    ];
  }

  return [
    `${company} can swing heavily because smaller ${profile.sector} names react fast to news.`,
    `${company} needs close tracking after purchase because liquidity and sentiment can change quickly.`,
    `${company} can fall fast if investors reduce exposure to riskier ${profile.sector} stocks.`
  ];
}

function bullCaseTriggersFor(profile: StockProfile) {
  const ticker = baseTicker(profile.symbol);
  const triggers: Record<string, string[]> = {
    TCS: [
      "US rate cuts could revive banking technology budgets at TCS's largest clients.",
      "A rebound in large digital transformation deals would lift TCS order visibility.",
      "Stable attrition and better utilisation could expand TCS operating margins."
    ],
    INFY: [
      "Infosys can rerate if large deal wins accelerate across US and European clients.",
      "Stronger discretionary tech spending would improve Infosys revenue growth.",
      "Margin recovery from automation and utilisation gains would support Infosys earnings."
    ],
    IDEA: [
      "Vodafone Idea can move sharply if tariff hikes improve average revenue per user.",
      "Fresh funding or government relief can strengthen Vodafone Idea's network investment plan.",
      "Subscriber losses slowing versus Airtel and Jio would improve Vodafone Idea sentiment."
    ],
    E2E: [
      "E2E Networks can rise if demand for Indian AI GPU cloud capacity keeps outstripping supply.",
      "New enterprise AI customers signing long-duration contracts would improve E2E revenue visibility.",
      "Higher utilisation of E2E's GPU and data-centre assets would expand operating leverage."
    ],
    RELIANCE: [
      "Reliance can rerate if Jio monetisation and retail growth accelerate together.",
      "A demerger or listing event for consumer businesses could unlock Reliance value.",
      "Improved refining margins would add upside to Reliance's energy cash flows."
    ]
  };

  if (triggers[ticker]) return triggers[ticker];
  return [
    `${profile.name} can move higher if ${profile.sector} demand improves over the next few quarters.`,
    `${profile.name} can rerate if revenue growth beats expectations while margins remain stable.`,
    `${profile.name} can attract fresh buying if institutional liquidity improves near the suggested entry zone.`
  ];
}

function exitSignalsFor(profile: StockProfile, buyBelowPrice: number) {
  const target = buyBelowPrice * 1.25;
  const low = profile.fiftyTwoWeekLow ?? buyBelowPrice * 0.9;
  return [
    `Consider taking profits near ${INR_FORMATTER.format(target)}, which is 25% above the buy-below price.`,
    `Cut the thesis if ${profile.name} breaks below its 52 week low near ${INR_FORMATTER.format(low)} on high volume.`
  ];
}

function upsideStats(profile: StockProfile, allocationAmount: number, buyBelowPrice: number) {
  const targetPrice = buyBelowPrice * 1.25;
  const shares = profile.price > 0 ? Math.floor(allocationAmount / profile.price) : 0;
  const upsidePercent = profile.price > 0 ? ((targetPrice - profile.price) / profile.price) * 100 : 0;
  const potentialProfit = Math.max(0, shares * Math.max(0, targetPrice - profile.price));
  return {
    targetPrice: Number(targetPrice.toFixed(2)),
    upsidePercent: Number(upsidePercent.toFixed(1)),
    potentialProfit: Math.round(potentialProfit)
  };
}

function applyPositionCap(weights: number[], maxWeight: number) {
  const capped = [...weights];

  for (let attempts = 0; attempts < 12; attempts += 1) {
    const excess = capped.reduce((sum, weight) => sum + Math.max(weight - maxWeight, 0), 0);
    if (excess <= 0.0001) break;

    for (let index = 0; index < capped.length; index += 1) {
      if (capped[index] > maxWeight) capped[index] = maxWeight;
    }

    const eligible = capped
      .map((weight, index) => ({ weight, index }))
      .filter((item) => item.weight < maxWeight);
    const eligibleTotal = eligible.reduce((sum, item) => sum + item.weight, 0);

    if (!eligible.length || eligibleTotal <= 0) break;

    eligible.forEach((item) => {
      capped[item.index] += excess * (item.weight / eligibleTotal);
    });
  }

  const total = capped.reduce((sum, weight) => sum + weight, 0);
  return total > 0 ? capped.map((weight) => weight / total) : weights;
}

function firstTranchePercent(riskLevel: RiskLevel, horizon: Horizon, trancheCount: number) {
  if (trancheCount <= 1) return 100;

  const base = 100 / trancheCount;
  const riskBoost = riskLevel === "safe" ? -8 : riskLevel === "aggressive" ? 8 : 0;
  const horizonBoost = horizon === "short" ? 8 : horizon === "long" ? -6 : 0;
  return Math.round(clamp(base + riskBoost + horizonBoost, 15, 60));
}

function buildHealthChecks(
  rows: Array<{ bucket: Bucket; allocationPercent: number; volatility: number | null }>,
  maxPositionPercent: number,
  cashReservePercent: number
) {
  const largest = rows.reduce((max, row) => Math.max(max, row.allocationPercent), 0);
  const speculative = rows
    .filter((row) => row.bucket === "Speculative")
    .reduce((sum, row) => sum + row.allocationPercent, 0);
  const highVolCount = rows.filter((row) => (row.volatility ?? 0) >= 55).length;

  return [
    {
      label: "Concentration",
      status: largest <= maxPositionPercent ? "Good" : largest <= maxPositionPercent + 5 ? "Watch" : "Risk",
      detail:
        largest <= maxPositionPercent
          ? `Largest position is within the ${maxPositionPercent}% cap.`
          : `Largest position is ${largest.toFixed(1)}%, above the selected cap.`
    },
    {
      label: "Speculative exposure",
      status: speculative <= 15 ? "Good" : speculative <= 30 ? "Watch" : "Risk",
      detail: `${speculative.toFixed(1)}% of capital is allocated to speculative names.`
    },
    {
      label: "Volatility",
      status: highVolCount === 0 ? "Good" : highVolCount <= 1 ? "Watch" : "Risk",
      detail:
        highVolCount === 0
          ? "No selected stock shows very high annualized volatility."
          : `${highVolCount} selected stock${highVolCount === 1 ? "" : "s"} show high annualized volatility.`
    },
    {
      label: "Cash buffer",
      status: cashReservePercent >= 5 ? "Good" : cashReservePercent >= 2 ? "Watch" : "Risk",
      detail: `${cashReservePercent}% of total capital remains unallocated as cash.`
    }
  ];
}

function allocate({
  capital,
  riskLevel,
  profiles,
  cashReservePercent,
  maxPositionPercent,
  trancheCount,
  horizon
}: {
  capital: number;
  riskLevel: RiskLevel;
  profiles: StockProfile[];
  cashReservePercent: number;
  maxPositionPercent: number;
  trancheCount: number;
  horizon: Horizon;
}) {
  const bucketWeights = RISK_BUCKET_WEIGHTS[riskLevel];
  const rawWeights = profiles.map((profile) => {
    const peers = profiles.filter((stock) => stock.bucket === profile.bucket);
    const peerScoreTotal = peers.reduce((sum, stock) => sum + profileQuality(stock), 0);
    const intraBucketShare = profileQuality(profile) / Math.max(peerScoreTotal, 0.01);
    const availableBucketCount = Object.keys(bucketWeights).filter((bucket) =>
      profiles.some((stock) => stock.bucket === bucket)
    ).length;

    const redistributedWeight =
      profiles.some((stock) => stock.bucket === profile.bucket)
        ? bucketWeights[profile.bucket]
        : 1 / availableBucketCount;

    return redistributedWeight * intraBucketShare;
  });

  const totalRawWeight = rawWeights.reduce((sum, value) => sum + value, 0);
  const normalizedWeights = rawWeights.map((weight) => weight / totalRawWeight);
  const cappedWeights = applyPositionCap(normalizedWeights, maxPositionPercent / 100);
  const deployableCapital = Math.round(capital * (1 - cashReservePercent / 100));
  const firstTranche = firstTranchePercent(riskLevel, horizon, trancheCount);
  let runningAmount = 0;
  let runningPercentage = 0;
  let runningFirstTranche = 0;

  return profiles.map((profile, index) => {
    const rawPercentage =
      index === profiles.length - 1
        ? Math.max(0, 100 - runningPercentage)
        : cappedWeights[index] * 100;
    const roundedPercentage = Number(rawPercentage.toFixed(1));
    const amount =
      index === profiles.length - 1
        ? Math.max(0, deployableCapital - runningAmount)
        : Math.round((deployableCapital * roundedPercentage) / 100);
    const firstTrancheAmount =
      index === profiles.length - 1
        ? Math.max(0, Math.round((deployableCapital * firstTranche) / 100) - runningFirstTranche)
        : Math.round((amount * firstTranche) / 100);

    runningAmount += amount;
    runningPercentage += roundedPercentage;
    runningFirstTranche += firstTrancheAmount;

    const zoneHigh = profile.fairValue * 0.75;
    const zoneLow = profile.fairValue * 0.7;

    return {
      ticker: profile.requestedTicker,
      resolvedSymbol: profile.symbol,
      name: profile.name,
      bucket: profile.bucket,
      allocationPercent: roundedPercentage,
      allocationAmount: amount,
      formattedAmount: INR_FORMATTER.format(amount),
      firstTrancheAmount,
      formattedFirstTranche: INR_FORMATTER.format(firstTrancheAmount),
      estimatedShares: profile.price > 0 ? Math.floor(amount / profile.price) : 0,
      currentPrice: profile.price,
      estimatedFairValue: Number(profile.fairValue.toFixed(2)),
      buyBelowPrice: calculateBuyBelowPrice(profile, amount),
      entryZoneLow: Number(zoneLow.toFixed(2)),
      entryZoneHigh: Number(zoneHigh.toFixed(2)),
      entryZone: `${INR_FORMATTER.format(zoneLow)} - ${INR_FORMATTER.format(zoneHigh)}`,
      volatility: profile.annualVolatility ? Number((profile.annualVolatility * 100).toFixed(1)) : null,
      dataCurrency: profile.currency,
      confidence: confidenceFor(profile),
      riskTag: riskTagFor(profile),
      rationale: rationaleFor(profile),
      sector: profile.sector,
      fiftyTwoWeekHigh: profile.fiftyTwoWeekHigh,
      fiftyTwoWeekLow: profile.fiftyTwoWeekLow,
      currentPE: profile.currentPE,
      fiveYearAveragePE: profile.fiveYearAveragePE,
      fallFromHighPercent: fallFromHigh(profile) !== null ? Number((fallFromHigh(profile) as number).toFixed(1)) : null,
      buySignal: buySignalFor(profile),
      riskBullets: riskBulletsFor(profile),
      canBuy: amount >= profile.price,
      watchMessage: amount < profile.price ? "Capital too low to buy even 1 share at current price. Watch this stock and add capital later." : null,
      whyBucket: whyBucket(profile),
      whyAllocation: whyAllocation(profile, riskLevel, roundedPercentage),
      bullCaseTriggers: bullCaseTriggersFor(profile)
    };
  }).map((row) => {
    const profile = profiles.find((item) => item.symbol === row.resolvedSymbol) as StockProfile;
    const score = confidenceScore(profile, row.buySignal.tone);
    const upside = upsideStats(profile, row.allocationAmount, row.buyBelowPrice);
    return {
      ...row,
      whyBuyBelowPrice: whyBuyBelow(profile, row.buyBelowPrice),
      whySignal: row.buySignal.reason,
      exitSignals: exitSignalsFor(profile, row.buyBelowPrice),
      targetPrice: upside.targetPrice,
      upsidePercent: upside.upsidePercent,
      potentialProfit: upside.potentialProfit,
      formattedPotentialProfit: INR_FORMATTER.format(upside.potentialProfit),
      confidenceScore: score,
      confidenceReason: confidenceExplanation(profile, score),
      confidenceUpside: confidenceUpside(profile)
    };
  });
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as Partial<AllocationInput>;
    const capital = Number(body.capital);
    const riskLevel = body.riskLevel;
    const horizon = isHorizon(body.horizon) ? body.horizon : "medium";
    const cashReservePercent = clamp(Number(body.cashReservePercent ?? 5), 0, 40);
    const maxPositionPercent = clamp(Number(body.maxPositionPercent ?? 35), 10, 100);
    const trancheCount = Math.round(clamp(Number(body.trancheCount ?? 3), 1, 6));
    const tickers = Array.isArray(body.tickers)
      ? body.tickers.map(cleanTicker).filter(Boolean).slice(0, 5)
      : [];

    if (!Number.isFinite(capital) || capital <= 0) {
      return NextResponse.json({ error: "Enter a valid total capital amount." }, { status: 400 });
    }

    if (!isRiskLevel(riskLevel)) {
      return NextResponse.json({ error: "Choose safe, balanced, or aggressive risk." }, { status: 400 });
    }

    if (!Number.isFinite(cashReservePercent) || !Number.isFinite(maxPositionPercent)) {
      return NextResponse.json({ error: "Enter valid reserve and position cap values." }, { status: 400 });
    }

    if (!tickers.length) {
      return NextResponse.json({ error: "Enter at least one ticker." }, { status: 400 });
    }

    const selectedCharts = await Promise.all(
      tickers.map(async (ticker) => {
        const candidates = tickerCandidates(ticker);
        for (const candidate of candidates) {
          const chart = await fetchChartProfile(candidate);
          if (chart) return chart;
        }
        return null;
      })
    );

    const missing = tickers.filter((_, index) => !selectedCharts[index]);
    if (missing.length) {
      return NextResponse.json(
        { error: `Could not find market data for: ${missing.join(", ")}.` },
        { status: 404 }
      );
    }

    const profiles = await Promise.all(
      selectedCharts.map(async (chart, index) => {
        const safeChart = chart as NonNullable<(typeof selectedCharts)[number]>;
        const meta = safeChart.meta;
        const quote = await fetchQuoteProfile(meta.symbol ?? tickers[index]);
        const ticker = baseTicker(meta.symbol ?? tickers[index]);
        const price = meta.regularMarketPrice ?? safeChart.prices.at(-1) ?? 0;
        const volume = meta.regularMarketVolume ?? 0;
        const baseProfile = {
          requestedTicker: tickers[index],
          symbol: meta.symbol ?? tickers[index],
          name: meta.shortName ?? meta.longName ?? meta.symbol ?? tickers[index],
          sector: SECTOR_MAP[ticker] ?? "Indian equities",
          price,
          currency: meta.currency ?? "INR",
          marketCap: quote?.marketCap ?? null,
          dailyTurnover: volume > 0 ? price * volume : null,
          beta: null,
          annualVolatility: safeChart.annualVolatility,
          fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh ?? null,
          fiftyTwoWeekLow: meta.fiftyTwoWeekLow ?? null,
          currentPE: quote?.trailingPE ?? quote?.forwardPE ?? null,
          fiveYearAveragePE: PE_ANCHORS[ticker] ?? null,
          fairValue: estimateFairValue({
            price,
            fiftyDayAverage: safeChart.fiftyDayAverage,
            twoHundredDayAverage: safeChart.twoHundredDayAverage,
            fiftyTwoWeekHigh: meta.fiftyTwoWeekHigh,
            fiftyTwoWeekLow: meta.fiftyTwoWeekLow,
            volatility: safeChart.annualVolatility
          })
        };

        return {
          ...baseProfile,
          bucket: classifyBucket(baseProfile)
        };
      })
    );

    const rows = allocate({
      capital,
      riskLevel,
      profiles,
      cashReservePercent,
      maxPositionPercent,
      trancheCount,
      horizon
    });
    const deployableCapital = Math.round(capital * (1 - cashReservePercent / 100));
    const cashReserveAmount = capital - deployableCapital;
    const firstTranche = firstTranchePercent(riskLevel, horizon, trancheCount);

    return NextResponse.json({
      generatedAt: new Date().toISOString(),
      capital,
      formattedCapital: INR_FORMATTER.format(capital),
      riskLevel,
      rows,
      deploymentPlan: {
        deployableCapital,
        formattedDeployableCapital: INR_FORMATTER.format(deployableCapital),
        cashReserveAmount,
        formattedCashReserve: INR_FORMATTER.format(cashReserveAmount),
        cashReservePercent,
        maxPositionPercent,
        trancheCount,
        firstTranchePercent: firstTranche,
        firstTrancheTotal: Math.round((deployableCapital * firstTranche) / 100),
        formattedFirstTrancheTotal: INR_FORMATTER.format(
          Math.round((deployableCapital * firstTranche) / 100)
        ),
        horizon
      },
      healthChecks: buildHealthChecks(rows, maxPositionPercent, cashReservePercent),
      notes: [
        "Market data is fetched from free public Yahoo Finance chart endpoints.",
        "Fair value is estimated from price history, moving averages, 52-week range, and volatility; this is a planning aid, not financial advice.",
        "Entry zone uses a 25% margin of safety below estimated fair value.",
        "This output is for portfolio planning and is not financial advice."
      ]
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Something went wrong while generating the allocation."
      },
      { status: 500 }
    );
  }
}
