"use client";

import {
  Eye,
  CircleDollarSign,
  Download,
  Loader2,
  Plus,
  MessageCircle,
  Printer,
  Send,
  Target
} from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";

type RiskLevel = "safe" | "balanced" | "aggressive";
type Bucket = "Core" | "Growth" | "Speculative";

type BuySignal = {
  label: string;
  tone: "green" | "yellow" | "red";
  detail: string;
  reason: string;
};

type AllocationRow = {
  ticker: string;
  resolvedSymbol: string;
  name: string;
  bucket: Bucket;
  allocationPercent: number;
  allocationAmount: number;
  formattedAmount: string;
  estimatedShares: number;
  currentPrice: number;
  buyBelowPrice: number;
  fallFromHighPercent: number | null;
  buySignal: BuySignal;
  riskBullets: string[];
  canBuy: boolean;
  watchMessage: string | null;
  riskMeter: "Low Risk" | "Medium Risk" | "High Risk";
  buyPlan: string;
  plainBucket: string;
  whyBucket: string;
  whyAllocation: string;
  whyBuyBelowPrice: string;
  whySignal: string;
  bullCaseTriggers: string[];
  exitSignals: string[];
  targetPrice: number;
  upsidePercent: number;
  potentialProfit: number;
  formattedPotentialProfit: string;
  confidenceScore: number;
  confidenceReason: string;
  confidenceUpside: string;
};

type AllocationResponse = {
  generatedAt: string;
  capital: number;
  formattedCapital: string;
  riskLevel: RiskLevel;
  rows: AllocationRow[];
  sectorWarnings: string[];
};

const currency = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0
});

const priceFormat = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2
});

const riskLabels: Record<RiskLevel, string> = {
  safe: "Play It Safe",
  balanced: "Mix It Up",
  aggressive: "Maximum Upside"
};

const riskDescriptions: Record<RiskLevel, string> = {
  safe: "Slow and steady. Protect your money first.",
  balanced: "Some safety, some growth. Best of both.",
  aggressive: "Higher risk. Higher reward. Go big."
};

const loadingMessages = [
  "Fetching live market data...",
  "Analysing your stocks...",
  "Building your allocation...",
  "Almost ready..."
];

function bucketClass(bucket: Bucket) {
  return bucket.toLowerCase();
}

function bucketReason(row: AllocationRow) {
  if (row.bucket === "Core") return "Large stable company. Good anchor for long term portfolios.";
  if (row.bucket === "Growth") return "Growing company. Better upside, but price can move fast.";
  return "Riskier stock. Keep position smaller and monitor closely.";
}

function scenarioValue(rows: AllocationRow[], bucket: Bucket, returnPercent: number, capital: number) {
  const bucketCapital = rows
    .filter((row) => row.bucket === bucket)
    .reduce((sum, row) => sum + row.allocationAmount, 0);
  return capital + bucketCapital * returnPercent;
}

function bucketAmount(rows: AllocationRow[], bucket: Bucket) {
  return rows.filter((row) => row.bucket === bucket).reduce((sum, row) => sum + row.allocationAmount, 0);
}

function signalCount(rows: AllocationRow[], tone: BuySignal["tone"]) {
  return rows.filter((row) => row.buySignal.tone === tone).length;
}

function portfolioVerdict(rows: AllocationRow[]) {
  const buy = signalCount(rows, "green");
  const accumulate = signalCount(rows, "yellow");
  const wait = signalCount(rows, "red");
  return `${buy} buy, ${accumulate} accumulate, ${wait} wait. The plan below shows what to buy, what to watch, and where the possible upside comes from.`;
}

function scenarioGain(rows: AllocationRow[], bucket: Bucket, returnPercent: number) {
  return bucketAmount(rows, bucket) * returnPercent;
}

export default function Home() {
  const [capital, setCapital] = useState("500000");
  const [riskLevel, setRiskLevel] = useState<RiskLevel>("balanced");
  const [tickers, setTickers] = useState(["", "", "", "", ""]);
  const [viewMode, setViewMode] = useState<"simple" | "detailed">("simple");
  const [result, setResult] = useState<AllocationResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      setLoadingIndex(0);
      return;
    }

    const interval = window.setInterval(() => {
      setLoadingIndex((current) => (current + 1) % loadingMessages.length);
    }, 2000);

    return () => window.clearInterval(interval);
  }, [loading]);

  const cleanTickers = useMemo(
    () => tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean),
    [tickers]
  );

  const bucketTotals = useMemo(() => {
    const totals: Record<Bucket, number> = { Core: 0, Growth: 0, Speculative: 0 };
    result?.rows.forEach((row) => {
      totals[row.bucket] += row.allocationPercent;
    });
    return totals;
  }, [result]);

  const coreScenario = result ? scenarioValue(result.rows, "Core", 0.15, result.capital) : 0;
  const realisticScenario = result ? scenarioValue(result.rows, "Growth", 0.35, result.capital) : 0;
  const bestCaseScenario = result
    ? result.capital + bucketAmount(result.rows, "Core") * 0.15 + bucketAmount(result.rows, "Growth") * 0.35
    : 0;
  const coreGain = result ? scenarioGain(result.rows, "Core", 0.15) : 0;
  const growthGain = result ? scenarioGain(result.rows, "Growth", 0.35) : 0;
  const bestCaseGain = coreGain + growthGain;

  async function generateAllocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const startedAt = Date.now();

    try {
      const response = await fetch("/api/allocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          capital: Number(capital),
          riskLevel,
          horizon: "medium",
          cashReservePercent: 0,
          maxPositionPercent: 40,
          trancheCount: 1,
          tickers: cleanTickers
        })
      });

      const data = await response.json();
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 3000 - (Date.now() - startedAt))));

      if (!response.ok) throw new Error(data.error ?? "Could not generate allocation.");
      setResult(data);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Could not generate allocation.");
    } finally {
      setLoading(false);
    }
  }

  function updateTicker(index: number, value: string) {
    setTickers((current) =>
      current.map((ticker, currentIndex) =>
        currentIndex === index ? value.toUpperCase().replace(/\s/g, "") : ticker
      )
    );
  }

  function addTickerInput() {
    setTickers((current) => [...current, ""]);
  }

  function removeTickerInput(index: number) {
    setTickers((current) => current.length <= 1 ? current : current.filter((_, currentIndex) => currentIndex !== index));
  }

  function downloadCsv() {
    if (!result) return;
    const headers = ["Ticker", "Company", "Signal", "Bucket", "Allocation %", "Amount", "Shares", "Buy Below", "Current Price", "Fall From High"];
    const rows = result.rows.map((row) => [
      row.ticker,
      row.name,
      row.buySignal.label,
      row.bucket,
      row.allocationPercent,
      row.allocationAmount,
      row.estimatedShares,
      row.buyBelowPrice,
      row.currentPrice,
      row.fallFromHighPercent ?? ""
    ]);
    const csv = [headers, ...rows]
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "war-room-allocation.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function shareOnWhatsApp() {
    const toolUrl = typeof window === "undefined" ? "the deployed tool" : window.location.origin;
    const message = `Just used the War Room Allocator by Aarit Shah to plan my portfolio. Try it here: ${toolUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <main className="war-room">
      <style>{pageCss}</style>

      <section className="hero">
        <div>
          <p className="eyebrow">Stock allocation planner</p>
          <h1>War Room Allocator {"\u2014"} by Aarit Shah</h1>
          <p className="subhead">
            Add stocks from your current portfolio or stocks you are watching. The tool shows possible upside,
            better entry zones, risk level, and a simple buy/watch plan.
          </p>
        </div>
        <div className="hero-card">
          <span>Current setup</span>
          <strong>{riskLabels[riskLevel]}</strong>
          <small>{riskDescriptions[riskLevel]} | {cleanTickers.length} stocks added</small>
        </div>
      </section>

      <section className="layout">
        <form className="form-card" onSubmit={generateAllocation}>
          <div className="card-title">
            <Target size={18} aria-hidden />
            Inputs
          </div>

          <div className="guide-card">
            <strong>Start here</strong>
            <span>Enter your total capital, then add every stock you own or are thinking of buying. Use NSE tickers like TCS, INFY, RELIANCE, IDEA, E2E.</span>
          </div>

          <label className="field">
            <span>Total capital</span>
            <div className="input-shell">
              <CircleDollarSign size={18} aria-hidden />
              <b>INR</b>
              <input
                inputMode="numeric"
                min="1"
                value={capital}
                onChange={(event) => setCapital(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="500000"
              />
            </div>
          </label>

          <div className="risk-field">
            <span>Risk level</span>
            <div className="risk-options">
              {(["safe", "balanced", "aggressive"] as RiskLevel[]).map((risk) => (
                <button
                  key={risk}
                  className={riskLevel === risk ? "active" : ""}
                  type="button"
                  onClick={() => setRiskLevel(risk)}
                >
                  <strong>{riskLabels[risk]}</strong>
                  <small>{riskDescriptions[risk]}</small>
                </button>
              ))}
            </div>
          </div>

          <div className="field">
            <span>Stocks you own or are watching</span>
            <div className="ticker-grid">
              {tickers.map((ticker, index) => (
                <div className="ticker-row" key={index}>
                  <input
                    aria-label={`Ticker ${index + 1}`}
                    value={ticker}
                    onChange={(event) => updateTicker(index, event.target.value)}
                    placeholder="TICKER"
                    maxLength={18}
                  />
                  <button type="button" onClick={() => removeTickerInput(index)} aria-label={`Remove ticker ${index + 1}`}>×</button>
                </div>
              ))}
            </div>
            <button className="secondary" type="button" onClick={addTickerInput}>
              <Plus size={16} aria-hidden />
              Add another stock
            </button>
            <small className="field-help">No 5-stock limit. For speed, keep it under 25 stocks per run.</small>
          </div>

          <div className="view-toggle">
            <button type="button" className={viewMode === "simple" ? "active" : ""} onClick={() => setViewMode("simple")}>
              <Eye size={15} aria-hidden /> Simple
            </button>
            <button type="button" className={viewMode === "detailed" ? "active" : ""} onClick={() => setViewMode("detailed")}>
              Detailed
            </button>
          </div>

          <button className="primary" type="submit" disabled={loading || cleanTickers.length === 0}>
            {loading ? <Loader2 className="spin" size={18} aria-hidden /> : <Send size={18} aria-hidden />}
            {loading ? "Analysing your portfolio..." : "Generate allocation"}
          </button>
          {error ? <div className="error">{error}</div> : null}
        </form>

        <section className="output">
          {loading ? (
            <div className="loading-panel">
              <div className="pulse-dots"><span /><span /><span /></div>
              <strong>{loadingMessages[loadingIndex]}</strong>
              <small>War Room is reading the market data.</small>
            </div>
          ) : !result ? (
            <div className="empty-panel">
              <strong>Your personalised portfolio plan</strong>
              <span>Enter your details and hit generate</span>
              <small>Results appear here in seconds</small>
            </div>
          ) : (
            <>
              <section className="portfolio-summary">
                <div>
                  <p className="eyebrow">Portfolio Level Summary</p>
                  <h2>{portfolioVerdict(result.rows)}</h2>
                  <p className="summary-explainer">
                    Core means safer base stocks. Growth means higher upside stocks. Speculative means higher-risk bets.
                    Buy zone means the stock looks interesting now. Accumulate means buy slowly. Wait means do not rush.
                  </p>
                </div>
                <div className="mobile-jumps" aria-label="Report shortcuts">
                  <a href="#upside">Upside</a>
                  <a href="#stocks">Stocks</a>
                  <a href="#disclaimer">Disclaimer</a>
                </div>
                <div className="summary-row">
                  <div><span>Total capital</span><strong>{currency.format(result.capital)}</strong></div>
                  <div><span>Stocks analysed</span><strong>{result.rows.length}</strong></div>
                  <div><span>Risk profile</span><strong>{riskLabels[result.riskLevel]}</strong></div>
                </div>
                <div className="summary-row three">
                  {(["Core", "Growth", "Speculative"] as Bucket[]).map((bucket) => (
                    <div key={bucket}>
                      <span>{bucket}</span>
                      <strong>{bucketTotals[bucket].toFixed(1)}%</strong>
                      <small>{currency.format(bucketAmount(result.rows, bucket))}</small>
                    </div>
                  ))}
                </div>
                <div className="summary-row three">
                  <div><span>Buy zone</span><strong>{signalCount(result.rows, "green")}/{result.rows.length}</strong></div>
                  <div><span>Accumulate</span><strong>{signalCount(result.rows, "yellow")}/{result.rows.length}</strong></div>
                  <div><span>Wait zone</span><strong>{signalCount(result.rows, "red")}/{result.rows.length}</strong></div>
                </div>
                {result.sectorWarnings.length ? (
                  <div className="warning-list">
                    {result.sectorWarnings.map((warning) => <p key={warning}>{warning}</p>)}
                  </div>
                ) : null}
              </section>

              <section className="scenario-section top-scenarios" id="upside">
                <p className="eyebrow">What You Could Make</p>
                <h2>If This Goes Right</h2>
                <p className="scenario-note">
                  These numbers only apply to the money allocated to each category. Example: if ₹20,000 is in Core,
                  a 15% Core return adds ₹3,000, not 15% on the full portfolio.
                </p>
                <div className="scenario-grid">
                  <div className="scenario-card">
                    <span>Conservative: if safer Core stocks return 15%</span>
                    <strong>{currency.format(coreScenario)}</strong>
                    <small>{currency.format(bucketAmount(result.rows, "Core"))} in Core + {currency.format(coreGain)} possible gain</small>
                  </div>
                  <div className="scenario-card">
                    <span>Realistic: if Growth stocks return 35%</span>
                    <strong>{currency.format(realisticScenario)}</strong>
                    <small>{currency.format(bucketAmount(result.rows, "Growth"))} in Growth + {currency.format(growthGain)} possible gain</small>
                  </div>
                  <div className="scenario-card best">
                    <span>Best Case: if Core and Growth both work</span>
                    <strong>{currency.format(bestCaseScenario)}</strong>
                    <small>Core + Growth possible gain: {currency.format(bestCaseGain)}</small>
                  </div>
                </div>
              </section>

              <section className="report-card">
                <div className="report-head">
                  <div>
                    <p className="eyebrow">Allocation report</p>
                    <h2>{riskLabels[result.riskLevel]} portfolio plan</h2>
                  </div>
                  <div className="action-row">
                    <button type="button" onClick={downloadCsv}><Download size={15} aria-hidden /> CSV</button>
                    <button type="button" onClick={() => window.print()}><Printer size={15} aria-hidden /> Print</button>
                  </div>
                </div>

                <div className="report-summary">
                  <span>{currency.format(result.capital)} capital</span>
                  <span>{result.rows.length} stocks</span>
                  <span>{riskLabels[result.riskLevel]}</span>
                  <span>Core {bucketTotals.Core.toFixed(1)}%</span>
                  <span>Growth {bucketTotals.Growth.toFixed(1)}%</span>
                  <span>Speculative {bucketTotals.Speculative.toFixed(1)}%</span>
                </div>

                <div className="bucket-strip">
                  {(Object.keys(bucketTotals) as Bucket[]).map((bucket) => (
                    <span key={bucket} className={`bucket-fill ${bucketClass(bucket)}`} style={{ width: `${bucketTotals[bucket]}%` }} />
                  ))}
                </div>

                <div className="stock-grid" id="stocks">
                  {result.rows.map((row) => (
                    <article className="stock-card" key={row.resolvedSymbol}>
                      <div className="stock-head">
                        <div className="stock-name">
                          <strong>{row.ticker}</strong>
                          <span>{row.name}</span>
                        </div>
                        <span className="fall-badge">
                          {"\u25BC"} {row.fallFromHighPercent !== null ? row.fallFromHighPercent.toFixed(0) : "0"}% from high
                        </span>
                      </div>

                      <span className={`bucket ${bucketClass(row.bucket)}`}>{row.bucket}</span>
                      <span className="plain-bucket">{row.plainBucket} · {row.riskMeter}</span>

                      <div className="big-money">
                        <span>Allocate</span>
                        <strong>{row.formattedAmount}</strong>
                      </div>

                      <div className="upside-grid">
                        <div>
                          <span>Possible upside</span>
                          <strong>{row.upsidePercent > 0 ? `+${row.upsidePercent.toFixed(1)}%` : "Wait"}</strong>
                          <small>From current price to profit target</small>
                        </div>
                        <div>
                          <span>Possible profit</span>
                          <strong>{row.formattedPotentialProfit}</strong>
                          <small>Based on estimated shares</small>
                        </div>
                        <div>
                          <span>Profit target</span>
                          <strong>{priceFormat.format(row.targetPrice)}</strong>
                          <small>Price where taking profits starts</small>
                        </div>
                      </div>

                      <div className="buy-plan">
                        <strong>{row.buySignal.tone === "red" ? "Watchlist mode" : "Suggested buy plan"}</strong>
                        <span>{row.buyPlan}</span>
                      </div>

                      {!row.canBuy ? (
                        <div className="watch-card">
                          <strong>Watch only</strong>
                          <span>{row.watchMessage}</span>
                        </div>
                      ) : (
                        <div className="price-line">
                          <div>
                            <span>Shares to buy</span>
                            <strong>{row.estimatedShares}</strong>
                          </div>
                          <div>
                            <span>Better entry price</span>
                            <strong>{priceFormat.format(row.buyBelowPrice)}</strong>
                          </div>
                        </div>
                      )}

                      <div className={`signal-banner ${row.buySignal.tone}`}>
                        <div>
                          <strong>{row.buySignal.label}</strong>
                        </div>
                        <span>{row.buySignal.detail}</span>
                      </div>

                      <p className="signal-reason">{row.buySignal.reason}</p>

                      {viewMode === "detailed" ? (
                        <div className="reason-grid">
                          <section><h3>Why this category</h3><p>{row.whyBucket}</p></section>
                          <section><h3>Why this amount</h3><p>{row.whyAllocation}</p></section>
                          <section><h3>Why this entry price</h3><p>{row.whyBuyBelowPrice}</p></section>
                          <section><h3>Why this signal</h3><p>{row.whySignal}</p></section>
                        </div>
                      ) : null}

                      <div className="confidence-box">
                        <h3>Conviction: {row.confidenceScore}/10</h3>
                        <div className="confidence-bar">
                          {Array.from({ length: 10 }).map((_, index) => (
                            <span key={index} className={index < row.confidenceScore ? "filled" : ""} />
                          ))}
                        </div>
                        <p>{row.confidenceReason}</p>
                        <small>{row.confidenceUpside}</small>
                      </div>

                      {viewMode === "detailed" ? <div className="risk-box">
                        <h3>Risk Snapshot</h3>
                        <ul>
                          {row.riskBullets.map((bullet) => <li key={bullet}>{bullet}</li>)}
                        </ul>
                      </div> : null}

                      <div className="risk-box">
                        <h3>Bull Case Triggers</h3>
                        <ul>
                          {row.bullCaseTriggers.map((bullet) => <li key={bullet}>{bullet}</li>)}
                        </ul>
                      </div>

                      <div className="risk-box">
                        <h3>Exit Signal</h3>
                        <ul>
                          {row.exitSignals.map((bullet) => <li key={bullet}>{bullet}</li>)}
                        </ul>
                      </div>
                    </article>
                  ))}
                </div>
              </section>

              <button className="whatsapp-button" type="button" onClick={shareOnWhatsApp}>
                <MessageCircle size={20} aria-hidden />
                Share My Allocation
              </button>

              <p className="legal-disclaimer" id="disclaimer">
                This tool is for educational purposes only and is not financial advice, research advice, or a recommendation to buy or sell any security under SEBI guidelines. Outputs are AI-generated and may be inaccurate. Past performance does not guarantee future results. Consult a SEBI registered investment advisor before investing. The creator holds no liability for any financial decisions made using this tool.
              </p>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

const pageCss = `
* { box-sizing: border-box; }
body {
  margin: 0;
  background: #0A0F1E;
  color: #E0E0E0;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input { font: inherit; }
button { border: 0; }
.war-room {
  min-height: 100vh;
  padding: 28px;
  background: #0A0F1E;
}
.hero, .layout { width: min(1480px, 100%); margin: 0 auto; }
.hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: end;
  gap: 24px;
  padding: 16px 0 26px;
}
.eyebrow {
  margin: 0 0 8px;
  color: #00C9A7;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
h1 {
  max-width: 900px;
  margin: 0 0 12px;
  color: #fff;
  font-size: clamp(42px, 5.6vw, 78px);
  line-height: 0.94;
  letter-spacing: 0;
}
h2 { margin: 0; color: #fff; font-size: 28px; line-height: 1.1; }
.subhead {
  max-width: 760px;
  margin: 0;
  color: #AAB4C5;
  font-size: 18px;
  line-height: 1.55;
}
.hero-card, .empty-panel, .loading-panel, .report-card, .metric-card, .scenario-section, .stock-card, .portfolio-summary {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #141B2D;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
}
.hero-card { padding: 18px; }
.hero-card span, .metric-card span, .scenario-card span, .big-money span, .price-line span {
  display: block;
  color: #AAB4C5;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}
.hero-card strong, .metric-card strong {
  display: block;
  margin-top: 8px;
  color: #fff;
  font-size: 30px;
  line-height: 1;
}
.hero-card small, .metric-card small { display: block; margin-top: 8px; color: #AAB4C5; font-weight: 700; }
.layout {
  display: grid;
  grid-template-columns: 390px minmax(0, 1fr);
  gap: 22px;
  align-items: start;
}
.form-card {
  position: sticky;
  top: 24px;
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #0F1628;
  padding: 22px;
  box-shadow: 0 22px 70px rgba(0, 0, 0, 0.28);
}
.card-title {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 18px;
  color: #00C9A7;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.field, .risk-field { display: grid; gap: 8px; margin-bottom: 18px; }
.field > span, .risk-field > span { color: #E0E0E0; font-size: 13px; font-weight: 900; }
.guide-card {
  display: grid;
  gap: 6px;
  margin-bottom: 18px;
  border: 1px solid #B7E5DC;
  border-radius: 8px;
  background: #E9F7F4;
  padding: 13px;
}
.guide-card strong { color: #050505; font-size: 15px; }
.guide-card span, .field-help {
  color: #334155;
  font-size: 12px;
  line-height: 1.45;
  font-weight: 750;
}
.input-shell {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 56px;
  padding: 0 14px;
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #141B2D;
}
.input-shell b { color: #AAB4C5; font-size: 12px; }
.input-shell input {
  width: 100%;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: #fff;
  font-size: 20px;
  font-weight: 850;
}
.risk-options { display: grid; gap: 8px; }
.risk-options button {
  display: grid;
  gap: 4px;
  min-height: 62px;
  padding: 12px;
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #141B2D;
  color: #fff;
  cursor: pointer;
  text-align: left;
}
.risk-options button.active {
  border-color: #00C9A7;
  box-shadow: 0 0 0 3px rgba(0, 201, 167, 0.16);
}
.risk-options small { color: #AAB4C5; font-weight: 700; }
.ticker-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.ticker-row { display: grid; grid-template-columns: 1fr 34px; gap: 6px; }
.ticker-grid input {
  min-width: 0;
  min-height: 50px;
  padding: 0 12px;
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  outline: 0;
  background: #141B2D;
  color: #fff;
  text-transform: uppercase;
  font-weight: 850;
}
.ticker-row button {
  border-radius: 8px;
  background: #FEE2E2;
  color: #991B1B;
  cursor: pointer;
  font-size: 20px;
  font-weight: 950;
}
.ticker-grid input:focus, .input-shell:focus-within {
  border-color: #00C9A7;
  box-shadow: 0 0 0 3px rgba(0, 201, 167, 0.14);
}
.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  min-height: 54px;
  border-radius: 8px;
  background: #00C9A7;
  color: #061512;
  cursor: pointer;
  font-weight: 950;
}
.primary:disabled { cursor: not-allowed; opacity: 0.52; }
.secondary, .view-toggle button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  min-height: 40px;
  border: 1px solid #D7E1DD;
  border-radius: 8px;
  background: #FFFFFF;
  color: #050505;
  cursor: pointer;
  font-weight: 900;
}
.view-toggle {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
  margin-bottom: 18px;
}
.view-toggle button.active {
  border-color: #00A88C;
  background: #E9F7F4;
  color: #007C68;
}
.error {
  margin-top: 14px;
  padding: 12px;
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.14);
  color: #FCA5A5;
  font-size: 13px;
  font-weight: 800;
}
.output { display: grid; gap: 14px; min-width: 0; }
.empty-panel, .loading-panel {
  min-height: 560px;
  display: grid;
  place-items: center;
  align-content: center;
  gap: 8px;
  padding: 44px;
  text-align: center;
}
.empty-panel strong {
  color: #fff;
  font-size: clamp(34px, 4vw, 58px);
  line-height: 1;
}
.empty-panel span { color: #AAB4C5; font-size: 16px; font-weight: 750; }
.empty-panel small { color: #7F8AA3; font-size: 12px; font-weight: 750; }
.pulse-dots { display: flex; gap: 10px; margin-bottom: 12px; }
.pulse-dots span {
  width: 13px;
  height: 13px;
  border-radius: 50%;
  background: #00C9A7;
  animation: pulse 900ms ease-in-out infinite alternate;
}
.pulse-dots span:nth-child(2) { animation-delay: 160ms; }
.pulse-dots span:nth-child(3) { animation-delay: 320ms; }
.loading-panel strong { color: #fff; font-size: clamp(28px, 3vw, 44px); }
.loading-panel small { color: #AAB4C5; font-weight: 750; }
@keyframes pulse { from { opacity: 0.35; transform: scale(0.75); } to { opacity: 1; transform: scale(1.18); } }
.summary-grid { display: grid; grid-template-columns: 1.1fr 1fr; gap: 12px; }
.metric-card { padding: 16px; }
.metric-card.dark { background: linear-gradient(135deg, #00C9A7, #141B2D); color: #fff; }
.portfolio-summary {
  display: grid;
  gap: 16px;
  padding: 22px;
  background: linear-gradient(135deg, rgba(0, 201, 167, 0.28), #141B2D 58%);
}
.portfolio-summary h2 { max-width: 920px; font-size: clamp(24px, 3vw, 38px); }
.summary-explainer, .scenario-note {
  max-width: 920px;
  margin: 10px 0 0;
  color: #334155;
  font-size: 15px;
  line-height: 1.5;
  font-weight: 750;
}
.mobile-jumps {
  position: sticky;
  top: 8px;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px;
  border: 1px solid #B7E5DC;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
}
.mobile-jumps a {
  flex: 1 1 110px;
  display: inline-flex;
  justify-content: center;
  border-radius: 8px;
  background: #E9F7F4;
  color: #007C68;
  padding: 9px 10px;
  text-decoration: none;
  font-size: 13px;
  font-weight: 950;
}
.summary-row {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}
.summary-row div {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: rgba(15, 22, 40, 0.72);
  padding: 14px;
}
.summary-row span, .summary-row small {
  display: block;
  color: #AAB4C5;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}
.summary-row strong {
  display: block;
  margin-top: 7px;
  color: #fff;
  font-size: 24px;
  line-height: 1;
}
.summary-row small { margin-top: 7px; text-transform: none; }
.warning-list {
  display: grid;
  gap: 8px;
}
.warning-list p {
  margin: 0;
  border: 1px solid #F59E0B;
  border-radius: 8px;
  background: #FEF3C7;
  color: #78350F;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 1.4;
  font-weight: 850;
}
.report-card { overflow: hidden; border-width: 2px; }
.report-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  padding: 26px;
  border-bottom: 1px solid #1E2D4A;
}
.action-row { display: flex; gap: 8px; }
.action-row button {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 12px;
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #0F1628;
  color: #E0E0E0;
  cursor: pointer;
  font-weight: 850;
}
.bucket-strip {
  display: flex;
  height: 14px;
  margin: 24px 26px 0;
  overflow: hidden;
  border-radius: 999px;
  background: #0F1628;
}
.report-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 18px 26px 0;
}
.report-summary span {
  border: 1px solid #1E2D4A;
  border-radius: 999px;
  background: #0F1628;
  color: #E0E0E0;
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 900;
}
.bucket-fill.core, .dot.core { background: #22C55E; }
.bucket-fill.growth, .dot.growth { background: #F59E0B; }
.bucket-fill.speculative, .dot.speculative { background: #EF4444; }
.stock-grid { display: grid; gap: 20px; padding: 24px 26px 26px; }
.stock-card {
  display: grid;
  gap: 16px;
  padding: 22px;
  border-left: 4px solid #00C9A7;
}
.stock-card + .stock-card { border-top: 1px solid #1E2D4A; }
.stock-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.stock-name { display: grid; gap: 4px; }
.stock-name strong { color: #fff; font-size: clamp(28px, 3vw, 40px); }
.stock-name span {
  color: #AAB4C5;
  font-size: 20px;
  font-weight: 750;
  white-space: normal;
  overflow-wrap: break-word;
  word-break: normal;
}
.fall-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(239, 68, 68, 0.16);
  color: #FCA5A5;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 950;
}
.bucket {
  justify-self: start;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  border-radius: 999px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 950;
  white-space: nowrap;
}
.bucket.core { background: rgba(34, 197, 94, 0.14); color: #86EFAC; }
.bucket.growth { background: rgba(245, 158, 11, 0.16); color: #FCD34D; }
.bucket.speculative { background: rgba(239, 68, 68, 0.16); color: #FCA5A5; }
.plain-bucket {
  justify-self: start;
  border-radius: 999px;
  background: #E9F7F4;
  color: #007C68;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 950;
}
.big-money strong {
  display: block;
  margin-top: 5px;
  color: #00C9A7;
  font-size: clamp(32px, 4.4vw, 58px);
  line-height: 1;
}
.price-line {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.price-line div {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #0F1628;
  padding: 14px;
}
.price-line strong {
  display: block;
  margin-top: 6px;
  color: #fff;
  font-size: 23px;
  font-variant-numeric: tabular-nums;
}
.watch-card {
  border: 1px solid rgba(252, 165, 165, 0.34);
  border-radius: 8px;
  background: rgba(239, 68, 68, 0.12);
  padding: 16px;
}
.watch-card strong { display: block; color: #FCA5A5; font-size: 22px; }
.watch-card span { display: block; margin-top: 6px; color: #E0E0E0; font-weight: 800; }
.buy-plan {
  border: 1px solid #B7E5DC;
  border-radius: 8px;
  background: #E9F7F4;
  padding: 14px;
}
.buy-plan strong {
  display: block;
  color: #007C68;
  font-size: 17px;
}
.buy-plan span {
  display: block;
  margin-top: 5px;
  color: #050505;
  font-weight: 850;
  line-height: 1.4;
}
.signal-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  border-radius: 8px;
  padding: 17px 18px;
  color: #fff;
}
.signal-banner.green { background: #15803D; }
.signal-banner.yellow { background: #B45309; }
.signal-banner.red { background: #B91C1C; }
.signal-banner strong { display: block; font-size: clamp(22px, 3vw, 36px); line-height: 1; }
.signal-banner span { display: block; max-width: 330px; text-align: right; font-weight: 850; }
.signal-reason {
  margin: -6px 0 0;
  color: #AAB4C5;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 750;
}
.reason-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.reason-grid section, .confidence-box {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #0F1628;
  padding: 14px;
}
.reason-grid h3, .confidence-box h3, .risk-box h3 {
  border-left: 3px solid #00C9A7;
  padding-left: 10px;
}
.reason-grid h3, .confidence-box h3 {
  margin: 0 0 8px;
  color: #fff;
  font-size: 16px;
}
.reason-grid p, .confidence-box p, .confidence-box small {
  margin: 0;
  color: #AAB4C5;
  font-size: 14px;
  line-height: 1.45;
  font-weight: 750;
}
.confidence-box small { display: block; margin-top: 8px; color: #7F8AA3; }
.confidence-bar {
  display: grid;
  grid-template-columns: repeat(10, 1fr);
  gap: 5px;
  margin-bottom: 10px;
}
.confidence-bar span {
  height: 10px;
  border-radius: 999px;
  background: #263550;
}
.confidence-bar span.filled { background: #00C9A7; }
.risk-box {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #192238;
  padding: 16px;
}
.risk-box h3 { margin: 0 0 10px; color: #fff; font-size: 18px; }
.risk-box ul {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 18px;
  color: #E0E0E0;
  font-size: 14px;
  line-height: 1.4;
  font-weight: 750;
}
.scenario-section { display: grid; gap: 16px; padding: 22px; }
.scenario-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.scenario-card {
  border: 1px solid #1E2D4A;
  border-radius: 8px;
  background: #0F1628;
  padding: 18px;
}
.scenario-card strong {
  display: block;
  margin-top: 10px;
  color: #00C9A7;
  font-size: clamp(30px, 4vw, 48px);
  line-height: 1;
}
.scenario-note { margin-bottom: 2px; }
.whatsapp-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  min-height: 56px;
  border-radius: 8px;
  background: #25D366;
  color: #062D17;
  cursor: pointer;
  font-size: 17px;
  font-weight: 950;
}
.legal-disclaimer {
  max-width: 980px;
  margin: 0 auto 8px;
  color: #7F8AA3;
  text-align: center;
  font-size: 11px;
  line-height: 1.45;
}
.upside-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
.upside-grid div {
  border: 1px solid #B7E5DC;
  border-radius: 8px;
  background: #E9F7F4;
  padding: 16px;
}
.upside-grid span, .upside-grid small, .scenario-card small {
  display: block;
  color: #425466;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
}
.upside-grid strong {
  display: block;
  margin-top: 7px;
  color: #007C68;
  font-size: clamp(28px, 4vw, 48px);
  line-height: 1;
}
.upside-grid small, .scenario-card small { margin-top: 7px; text-transform: none; }
.scenario-card.best {
  border-color: #00A88C;
  background: #E9F7F4;
}

/* Clarity pass: black text on light cards, with teal reserved for upside and actions. */
body, .war-room { background: #F4F7F5; color: #050505; }
h1, h2, .hero-card strong, .metric-card strong, .summary-row strong, .stock-name strong,
.price-line strong, .reason-grid h3, .confidence-box h3, .risk-box h3 {
  color: #050505;
}
.hero-card, .empty-panel, .loading-panel, .report-card, .metric-card,
.scenario-section, .stock-card, .portfolio-summary, .form-card {
  border-color: #D7E1DD;
  background: #FFFFFF;
  box-shadow: 0 18px 50px rgba(15, 23, 42, 0.1);
}
.subhead, .hero-card small, .metric-card small, .stock-name span, .signal-reason,
.reason-grid p, .confidence-box p, .confidence-box small, .summary-row span,
.summary-row small, .hero-card span, .metric-card span, .scenario-card span,
.big-money span, .price-line span {
  color: #334155;
}
.eyebrow, .card-title { color: #007C68; }
.field > span, .risk-field > span, .risk-options button, .ticker-grid input,
.input-shell input, .risk-box ul, .legal-disclaimer { color: #050505; }
.input-shell, .risk-options button, .ticker-grid input, .price-line div,
.reason-grid section, .confidence-box, .risk-box, .scenario-card,
.summary-row div, .report-summary span {
  border-color: #D7E1DD;
  background: #F8FAFC;
}
.portfolio-summary {
  background: linear-gradient(135deg, rgba(0, 201, 167, 0.22), #FFFFFF 58%);
}
.stock-card { border-left: 5px solid #00A88C; }
.stock-card + .stock-card { border-top-color: #D7E1DD; }
.summary-row strong, .scenario-card strong, .big-money strong { color: #007C68; }
.signal-banner.green, .signal-banner.yellow, .signal-banner.red { color: #FFFFFF; }
.watch-card span { color: #050505; }
.confidence-bar span { background: #D7E1DD; }
.confidence-bar span.filled { background: #00A88C; }
.spin { animation: spin 900ms linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
@media (max-width: 1120px) {
  .hero, .layout, .summary-grid, .scenario-grid, .summary-row, .reason-grid, .upside-grid { grid-template-columns: 1fr; }
  .form-card { position: static; }
}
@media (max-width: 680px) {
  .war-room { padding: 16px; }
  h1 { font-size: 42px; }
  .portfolio-summary h2 { font-size: 26px; line-height: 1.12; }
  .summary-explainer, .scenario-note { font-size: 14px; }
  .report-head, .stock-grid, .bucket-strip, .report-summary { padding-left: 16px; padding-right: 16px; }
  .stock-card { padding: 16px; }
  .upside-grid strong, .scenario-card strong { font-size: 34px; }
  .stock-name strong { font-size: 30px; }
  .ticker-grid, .price-line { grid-template-columns: 1fr; }
  .report-head, .stock-head, .signal-banner { flex-direction: column; }
  .signal-banner { align-items: flex-start; }
  .signal-banner span { text-align: left; }
  .fall-badge { align-self: flex-start; }
}
@media print {
  .war-room { padding: 0; background: #fff; color: #111; }
  .form-card, .hero-card, .action-row, .whatsapp-button { display: none; }
  .hero, .layout, .summary-grid, .scenario-grid { display: block; width: 100%; }
  .report-card, .metric-card, .scenario-section { box-shadow: none; margin-bottom: 12px; }
}
`;
