"use client";

import { FormEvent, useMemo, useState } from "react";

type Inputs = {
  revenue: number;
  shares: number;
  netDebt: number;
  growth: number;
  margin: number;
  tax: number;
  capex: number;
  wacc: number;
  terminalGrowth: number;
};

type ForecastRow = {
  year: number;
  revenue: number;
  operatingProfit: number;
  afterTaxProfit: number;
  capex: number;
  fcf: number;
  discountFactor: number;
  pvFcf: number;
};

type LookupResponse = {
  companyName?: string;
  revenue?: number;
  shares?: number;
  netDebt?: number;
  warning?: string;
};

const DEFAULT_INPUTS: Inputs = {
  revenue: 1000,
  shares: 100,
  netDebt: 200,
  growth: 8,
  margin: 20,
  tax: 21,
  capex: 5,
  wacc: 9,
  terminalGrowth: 2.5,
};

const ASSUMPTIONS = [
  {
    key: "growth",
    label: "Revenue growth",
    min: -10,
    max: 30,
    step: 0.5,
    help: "How quickly revenue rises or falls each year.",
  },
  {
    key: "margin",
    label: "Operating margin",
    min: 0,
    max: 50,
    step: 0.5,
    help: "The share of revenue retained as operating profit.",
  },
  {
    key: "tax",
    label: "Tax rate",
    min: 0,
    max: 40,
    step: 0.5,
    help: "The tax rate applied to operating profit.",
  },
  {
    key: "capex",
    label: "Capital expenditure",
    min: 0,
    max: 20,
    step: 0.5,
    help: "Long-term asset spending as a share of revenue.",
  },
  {
    key: "wacc",
    label: "Discount rate / WACC",
    min: 5,
    max: 20,
    step: 0.5,
    help: "The return investors require from the business.",
  },
  {
    key: "terminalGrowth",
    label: "Terminal growth",
    min: 0,
    max: 5,
    step: 0.1,
    help: "Perpetual growth assumed after year five.",
  },
] as const;

function projectForecast(inputs: Inputs): ForecastRow[] {
  const growth = inputs.growth / 100;
  const margin = inputs.margin / 100;
  const tax = inputs.tax / 100;
  const capexRate = inputs.capex / 100;
  const wacc = inputs.wacc / 100;
  const forecast: ForecastRow[] = [];
  let revenue = Math.max(0, inputs.revenue);

  for (let year = 1; year <= 5; year += 1) {
    revenue *= 1 + growth;
    const operatingProfit = revenue * margin;
    const afterTaxProfit = operatingProfit * (1 - tax);
    const capex = revenue * capexRate;
    const fcf = afterTaxProfit - capex;
    const discountFactor = 1 / (1 + wacc) ** year;
    forecast.push({
      year,
      revenue,
      operatingProfit,
      afterTaxProfit,
      capex,
      fcf,
      discountFactor,
      pvFcf: fcf * discountFactor,
    });
  }

  return forecast;
}

function calculateValuation(inputs: Inputs) {
  if (inputs.shares <= 0 || inputs.terminalGrowth >= inputs.wacc) {
    return null;
  }

  const forecast = projectForecast(inputs);
  const wacc = inputs.wacc / 100;
  const terminalGrowth = inputs.terminalGrowth / 100;
  const yearFiveFcf = forecast[4].fcf;
  const terminalValue =
    (yearFiveFcf * (1 + terminalGrowth)) / (wacc - terminalGrowth);
  const pvTerminal = terminalValue / (1 + wacc) ** 5;
  const pvForecast = forecast.reduce((sum, row) => sum + row.pvFcf, 0);
  const enterpriseValue = pvForecast + pvTerminal;
  const equityValue = enterpriseValue - inputs.netDebt;

  return {
    forecast,
    pvForecast,
    pvTerminal,
    enterpriseValue,
    equityValue,
    valuePerShare: equityValue / inputs.shares,
    terminalContribution:
      enterpriseValue === 0 ? null : pvTerminal / enterpriseValue,
  };
}

function centeredSeries(
  center: number,
  step: number,
  min: number,
  max: number,
) {
  const start = Math.min(Math.max(center - step * 2, min), max - step * 4);
  return Array.from({ length: 5 }, (_, index) => start + index * step);
}

function formatMoney(value: number, decimals = 1) {
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })}m`;
}

function formatPerShare(value: number) {
  const sign = value < 0 ? "−" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function Home() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULT_INPUTS);
  const [submitted, setSubmitted] = useState<Inputs>(DEFAULT_INPUTS);
  const [ticker, setTicker] = useState("");
  const [companyName, setCompanyName] = useState("Illustrative company");
  const [lookupStatus, setLookupStatus] = useState("");
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [formError, setFormError] = useState("");

  const valuation = useMemo(() => calculateValuation(submitted), [submitted]);

  const sensitivity = useMemo(() => {
    const waccValues = centeredSeries(submitted.wacc, 1, 5, 20);
    const growthValues = centeredSeries(
      submitted.terminalGrowth,
      0.5,
      0,
      5,
    );

    return {
      waccValues,
      growthValues,
      values: growthValues.map((terminalGrowth) =>
        waccValues.map((wacc) => {
          if (terminalGrowth >= wacc) return null;
          return calculateValuation({
            ...submitted,
            wacc,
            terminalGrowth,
          })?.valuePerShare;
        }),
      ),
    };
  }, [submitted]);

  async function autofillTicker() {
    const cleanTicker = ticker.trim().toUpperCase();
    if (!cleanTicker) {
      setLookupStatus("Enter a US stock ticker first.");
      return;
    }

    setIsLookingUp(true);
    setLookupStatus("");
    try {
      const response = await fetch(
        `/api/ticker?symbol=${encodeURIComponent(cleanTicker)}`,
      );
      const data = (await response.json()) as LookupResponse;
      if (!response.ok) {
        throw new Error(
          data.warning || "We could not retrieve data for that ticker.",
        );
      }

      setCompanyName(data.companyName || cleanTicker);
      setInputs((current) => ({
        ...current,
        revenue: data.revenue ?? current.revenue,
        shares: data.shares ?? current.shares,
        netDebt: data.netDebt ?? current.netDebt,
      }));
      setLookupStatus(
        data.warning ||
          `Loaded available data for ${data.companyName || cleanTicker}. Review every value before calculating.`,
      );
    } catch (error) {
      setLookupStatus(
        error instanceof Error
          ? error.message
          : "The lookup failed. You can continue with manual inputs.",
      );
    } finally {
      setIsLookingUp(false);
    }
  }

  function updateInput(key: keyof Inputs, value: number) {
    setInputs((current) => ({ ...current, [key]: value }));
  }

  function submitValuation(event: FormEvent) {
    event.preventDefault();
    if (inputs.shares <= 0) {
      setFormError("Shares outstanding must be greater than zero.");
      return;
    }
    if (inputs.terminalGrowth >= inputs.wacc) {
      setFormError("Terminal growth must be lower than WACC.");
      return;
    }
    setFormError("");
    setSubmitted({ ...inputs });
  }

  const maxRevenue = Math.max(
    ...(valuation?.forecast.map((row) => row.revenue) ?? [1]),
    1,
  );
  const maxFcf = Math.max(
    ...(valuation?.forecast.map((row) => Math.abs(row.fcf)) ?? [1]),
    1,
  );

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DCF Lab home">
          <span className="brand-mark">D</span>
          <span>DCF Lab</span>
        </a>
        <span className="education-pill">Educational model</span>
      </header>

      <section className="hero" id="top">
        <div className="hero-heading">
          <p className="eyebrow">Interactive valuation workbench</p>
          <h1>Turn a few assumptions into an intrinsic value.</h1>
          <p className="intro">
            Forecast five years of revenue and simplified free cash flow, then
            see exactly how discounting, terminal value, and net debt shape the
            result.
          </p>
        </div>
        <div className="hero-note">
          <span>01</span>
          <p>
            Start with the defaults or enter a US ticker. Every retrieved value
            stays editable.
          </p>
        </div>
      </section>

      <form className="workspace" onSubmit={submitValuation}>
        <section className="input-panel" aria-labelledby="inputs-title">
          <div className="section-title">
            <div>
              <p>Inputs</p>
              <h2 id="inputs-title">Build the case</h2>
            </div>
            <span>USD millions</span>
          </div>

          <div className="lookup">
            <div>
              <label htmlFor="ticker">Optional US ticker</label>
              <div className="ticker-row">
                <input
                  id="ticker"
                  value={ticker}
                  onChange={(event) => setTicker(event.target.value)}
                  placeholder="AAPL"
                  maxLength={10}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={autofillTicker}
                  disabled={isLookingUp}
                >
                  {isLookingUp ? "Looking up…" : "Autofill Basic Data"}
                </button>
              </div>
            </div>
            {lookupStatus && <p className="lookup-message">{lookupStatus}</p>}
          </div>

          <div className="company-strip">
            <span>Current case</span>
            <strong>{companyName}</strong>
          </div>

          <div className="financial-grid">
            <label>
              <span>Current annual revenue</span>
              <div className="number-input">
                <b>$</b>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={inputs.revenue}
                  onChange={(event) =>
                    updateInput("revenue", Number(event.target.value))
                  }
                />
                <small>USD m</small>
              </div>
            </label>
            <label>
              <span>Shares outstanding</span>
              <div className="number-input">
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={inputs.shares}
                  onChange={(event) =>
                    updateInput("shares", Number(event.target.value))
                  }
                />
                <small>shares m</small>
              </div>
            </label>
            <label>
              <span>Net debt</span>
              <div className="number-input">
                <b>$</b>
                <input
                  type="number"
                  step="any"
                  value={inputs.netDebt}
                  onChange={(event) =>
                    updateInput("netDebt", Number(event.target.value))
                  }
                />
                <small>USD m</small>
              </div>
              <em>Negative means net cash.</em>
            </label>
          </div>

          <div className="assumption-heading">
            <h3>Valuation assumptions</h3>
            <span>Drag to explore</span>
          </div>
          <div className="assumption-grid">
            {ASSUMPTIONS.map((assumption) => (
              <label className="range-control" key={assumption.key}>
                <span>
                  <span>
                    {assumption.label}
                    <button
                      type="button"
                      className="help"
                      aria-label={`${assumption.label}: ${assumption.help}`}
                      title={assumption.help}
                    >
                      ?
                    </button>
                  </span>
                  <output>{inputs[assumption.key].toFixed(1)}%</output>
                </span>
                <input
                  type="range"
                  min={assumption.min}
                  max={assumption.max}
                  step={assumption.step}
                  value={inputs[assumption.key]}
                  onChange={(event) =>
                    updateInput(assumption.key, Number(event.target.value))
                  }
                />
                <small>
                  <span>{assumption.min}%</span>
                  <span>{assumption.max}%</span>
                </small>
              </label>
            ))}
          </div>

          {formError && (
            <p className="form-error" role="alert">
              {formError}
            </p>
          )}
          <button className="calculate-button" type="submit">
            Calculate valuation
            <span aria-hidden="true">→</span>
          </button>
        </section>

        <section className="result-panel" aria-labelledby="result-title">
          {valuation && (
            <>
              <div className="section-title light">
                <div>
                  <p>Output</p>
                  <h2 id="result-title">Valuation snapshot</h2>
                </div>
                <span>5-year DCF</span>
              </div>

              <div className="headline-result">
                <p>Intrinsic value per share</p>
                <strong>{formatPerShare(valuation.valuePerShare)}</strong>
                <span>USD / share</span>
              </div>

              <div className="value-bridge">
                <div>
                  <p>Enterprise value</p>
                  <strong>{formatMoney(valuation.enterpriseValue)}</strong>
                </div>
                <span>−</span>
                <div>
                  <p>Net debt</p>
                  <strong>{formatMoney(submitted.netDebt)}</strong>
                </div>
                <span>=</span>
                <div>
                  <p>Equity value</p>
                  <strong>{formatMoney(valuation.equityValue)}</strong>
                </div>
              </div>

              <div className="terminal-card">
                <div className="terminal-copy">
                  <p>Where enterprise value comes from</p>
                  <strong>
                    {valuation.terminalContribution === null
                      ? "N/A"
                      : `${(valuation.terminalContribution * 100).toFixed(1)}%`}
                  </strong>
                  <span>from terminal value</span>
                </div>
                <div className="contribution-bar" aria-hidden="true">
                  <span
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          (valuation.terminalContribution ?? 0) * 100,
                        ),
                      )}%`,
                    }}
                  />
                </div>
                <div className="terminal-breakdown">
                  <span>
                    Forecast cash flows
                    <b>{formatMoney(valuation.pvForecast)}</b>
                  </span>
                  <span>
                    Terminal value
                    <b>{formatMoney(valuation.pvTerminal)}</b>
                  </span>
                </div>
                {(valuation.terminalContribution ?? 0) > 0.75 && (
                  <p className="terminal-warning">
                    This result relies heavily on terminal value. Check the
                    sensitivity table before drawing conclusions.
                  </p>
                )}
              </div>

              <p className="proxy-note">
                <b>Simplified FCF proxy</b> = after-tax operating profit −
                capital expenditure. It excludes depreciation, amortisation and
                working-capital changes.
              </p>
            </>
          )}
        </section>
      </form>

      {valuation && (
        <section className="analysis">
          <div className="analysis-heading">
            <div>
              <p className="eyebrow">Forecast</p>
              <h2>Follow the cash flow, year by year.</h2>
            </div>
            <p>
              All financial values below are in USD millions. Hover over chart
              bars for exact values.
            </p>
          </div>

          <div className="chart-grid">
            <article className="chart-card">
              <div className="card-heading">
                <div>
                  <p>Revenue outlook</p>
                  <strong>
                    {formatMoney(valuation.forecast[4].revenue)}
                  </strong>
                </div>
                <span>Year 5</span>
              </div>
              <div className="bar-chart revenue-chart">
                {valuation.forecast.map((row) => (
                  <div className="chart-column" key={row.year}>
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max(6, (row.revenue / maxRevenue) * 100)}%`,
                      }}
                    >
                      <span>{formatMoney(row.revenue)}</span>
                    </div>
                    <small>Y{row.year}</small>
                  </div>
                ))}
              </div>
            </article>

            <article className="chart-card dark-card">
              <div className="card-heading">
                <div>
                  <p>Simplified free cash flow</p>
                  <strong>{formatMoney(valuation.forecast[4].fcf)}</strong>
                </div>
                <span>Year 5</span>
              </div>
              <div className="bar-chart fcf-chart">
                {valuation.forecast.map((row) => (
                  <div className="chart-column" key={row.year}>
                    <div
                      className="bar"
                      style={{
                        height: `${Math.max(6, (Math.abs(row.fcf) / maxFcf) * 100)}%`,
                      }}
                    >
                      <span>{formatMoney(row.fcf)}</span>
                    </div>
                    <small>Y{row.year}</small>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <article className="table-card">
            <div className="table-heading">
              <div>
                <p>Five-year forecast</p>
                <h3>The model’s operating build</h3>
              </div>
              <span>USD millions, except factor</span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Revenue</th>
                    <th>Operating profit</th>
                    <th>After-tax profit</th>
                    <th>Capital expenditure</th>
                    <th>Simplified FCF</th>
                    <th>Discount factor</th>
                    <th>PV of FCF</th>
                  </tr>
                </thead>
                <tbody>
                  {valuation.forecast.map((row) => (
                    <tr key={row.year}>
                      <td>
                        <b>Year {row.year}</b>
                      </td>
                      <td>{formatMoney(row.revenue)}</td>
                      <td>{formatMoney(row.operatingProfit)}</td>
                      <td>{formatMoney(row.afterTaxProfit)}</td>
                      <td>{formatMoney(row.capex)}</td>
                      <td>
                        <b>{formatMoney(row.fcf)}</b>
                      </td>
                      <td>{row.discountFactor.toFixed(4)}</td>
                      <td>{formatMoney(row.pvFcf)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="sensitivity-card">
            <div className="sensitivity-copy">
              <p className="eyebrow">Sensitivity</p>
              <h2>One answer is never the whole story.</h2>
              <p>
                Compare value per share across nearby discount rates and
                perpetual growth assumptions. The outlined cell is your
                selected case.
              </p>
              <div className="legend">
                <span>
                  <i className="low" /> Lower value
                </span>
                <span>
                  <i className="high" /> Higher value
                </span>
              </div>
            </div>
            <div className="sensitivity-table-wrap">
              <p className="axis-label">Discount rate / WACC →</p>
              <table className="sensitivity-table">
                <thead>
                  <tr>
                    <th>Terminal growth ↓</th>
                    {sensitivity.waccValues.map((wacc) => (
                      <th key={wacc}>{wacc.toFixed(1)}%</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sensitivity.growthValues.map((growth, rowIndex) => (
                    <tr key={growth}>
                      <th>{growth.toFixed(1)}%</th>
                      {sensitivity.values[rowIndex].map((value, columnIndex) => {
                        const isSelected =
                          Math.abs(growth - submitted.terminalGrowth) < 0.01 &&
                          Math.abs(
                            sensitivity.waccValues[columnIndex] -
                              submitted.wacc,
                          ) < 0.01;
                        return (
                          <td
                            className={isSelected ? "selected-cell" : ""}
                            key={sensitivity.waccValues[columnIndex]}
                          >
                            {value === null || value === undefined
                              ? "N/A"
                              : formatPerShare(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <section className="learn-section">
            <div>
              <p className="eyebrow">Learn the logic</p>
              <h2>A DCF in plain English.</h2>
            </div>
            <div className="accordions">
              <details>
                <summary>How the model works</summary>
                <ol>
                  <li>Forecast revenue for five years.</li>
                  <li>Apply operating margin to estimate operating profit.</li>
                  <li>Deduct tax and capital expenditure for simplified FCF.</li>
                  <li>Discount future cash flows back to today.</li>
                  <li>Estimate cash flows after year five with terminal value.</li>
                  <li>Subtract net debt from enterprise value.</li>
                  <li>Divide equity value by shares outstanding.</li>
                </ol>
              </details>
              <details>
                <summary>How assumptions affect valuation</summary>
                <ul>
                  <li>Growth and higher margins normally increase value.</li>
                  <li>Tax, capital expenditure and WACC normally reduce value.</li>
                  <li>Terminal growth normally increases value.</li>
                  <li>Net debt lowers equity value, not enterprise value.</li>
                  <li>More shares reduce value per share.</li>
                </ul>
              </details>
              <details>
                <summary>Important limitations</summary>
                <ul>
                  <li>This is a simplified educational model.</li>
                  <li>Growth and margins stay constant for five years.</li>
                  <li>
                    Depreciation, amortisation and working capital are excluded.
                  </li>
                  <li>WACC is entered manually.</li>
                  <li>Terminal value can dominate the result.</li>
                  <li>Ticker data may be missing or inconsistent.</li>
                  <li>This is not financial advice or a recommendation.</li>
                </ul>
              </details>
            </div>
          </section>
        </section>
      )}

      <footer>
        <span>DCF Lab</span>
        <p>
          Built for learning. Verify every input before relying on any output.
        </p>
      </footer>
    </main>
  );
}
