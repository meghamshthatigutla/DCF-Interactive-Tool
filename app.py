"""Interactive DCF Valuation Tool.

A deliberately simplified, beginner-friendly five-year discounted cash flow
model built with Streamlit. All values are in USD millions unless noted.
"""

from __future__ import annotations

from typing import Any

import pandas as pd
import plotly.express as px
import streamlit as st
import yfinance as yf


FORECAST_YEARS = 5


def forecast_financials(
    current_revenue: float,
    revenue_growth: float,
    operating_margin: float,
    tax_rate: float,
    capex_percent: float,
) -> pd.DataFrame:
    """Forecast revenue and a simplified free-cash-flow proxy for five years."""
    rows: list[dict[str, float | int]] = []
    revenue = current_revenue

    for year in range(1, FORECAST_YEARS + 1):
        revenue *= 1 + revenue_growth
        operating_profit = revenue * operating_margin
        after_tax_operating_profit = operating_profit * (1 - tax_rate)
        capital_expenditure = revenue * capex_percent
        simplified_fcf = after_tax_operating_profit - capital_expenditure
        rows.append(
            {
                "Year": year,
                "Revenue": revenue,
                "Operating profit": operating_profit,
                "After-tax operating profit": after_tax_operating_profit,
                "Capital expenditure": capital_expenditure,
                "Simplified free cash flow": simplified_fcf,
            }
        )

    return pd.DataFrame(rows)


def discount_cash_flows(forecast: pd.DataFrame, wacc: float) -> pd.DataFrame:
    """Add discount factors and present values to a forecast."""
    discounted = forecast.copy()
    discounted["Discount factor"] = discounted["Year"].apply(
        lambda year: 1 / (1 + wacc) ** year
    )
    discounted["Present value of free cash flow"] = (
        discounted["Simplified free cash flow"] * discounted["Discount factor"]
    )
    return discounted


def calculate_terminal_value(
    year_five_fcf: float, wacc: float, terminal_growth: float
) -> tuple[float, float]:
    """Return terminal value and its present value using Gordon Growth."""
    if terminal_growth >= wacc:
        raise ValueError("Terminal growth must be lower than WACC.")

    terminal_value = (
        year_five_fcf * (1 + terminal_growth) / (wacc - terminal_growth)
    )
    present_value = terminal_value / (1 + wacc) ** FORECAST_YEARS
    return terminal_value, present_value


def calculate_valuation(
    current_revenue: float,
    shares_outstanding: float,
    net_debt: float,
    revenue_growth: float,
    operating_margin: float,
    tax_rate: float,
    capex_percent: float,
    wacc: float,
    terminal_growth: float,
) -> dict[str, Any]:
    """Run the complete simplified DCF valuation."""
    if shares_outstanding <= 0:
        raise ValueError("Shares outstanding must be greater than zero.")
    if terminal_growth >= wacc:
        raise ValueError("Terminal growth must be lower than WACC.")

    forecast = forecast_financials(
        current_revenue,
        revenue_growth,
        operating_margin,
        tax_rate,
        capex_percent,
    )
    forecast = discount_cash_flows(forecast, wacc)
    terminal_value, pv_terminal_value = calculate_terminal_value(
        float(forecast.iloc[-1]["Simplified free cash flow"]),
        wacc,
        terminal_growth,
    )

    pv_forecast = float(forecast["Present value of free cash flow"].sum())
    enterprise_value = pv_forecast + pv_terminal_value
    equity_value = enterprise_value - net_debt
    value_per_share = equity_value / shares_outstanding
    terminal_contribution = (
        pv_terminal_value / enterprise_value if enterprise_value != 0 else None
    )

    return {
        "forecast": forecast,
        "terminal_value": terminal_value,
        "pv_forecast": pv_forecast,
        "pv_terminal_value": pv_terminal_value,
        "enterprise_value": enterprise_value,
        "equity_value": equity_value,
        "value_per_share": value_per_share,
        "terminal_contribution": terminal_contribution,
    }


def generate_sensitivity_table(
    current_revenue: float,
    shares_outstanding: float,
    net_debt: float,
    revenue_growth: float,
    operating_margin: float,
    tax_rate: float,
    capex_percent: float,
    selected_wacc: float,
    selected_terminal_growth: float,
) -> pd.DataFrame:
    """Create a 5-by-5 value-per-share table around WACC and growth inputs."""
    wacc_values = [
        max(0.0001, selected_wacc + change)
        for change in (-0.02, -0.01, 0, 0.01, 0.02)
    ]
    growth_values = [
        max(0, selected_terminal_growth + change)
        for change in (-0.01, -0.005, 0, 0.005, 0.01)
    ]

    table: list[list[str]] = []
    for growth in growth_values:
        row: list[str] = []
        for wacc in wacc_values:
            if growth >= wacc:
                row.append("N/A")
                continue
            try:
                result = calculate_valuation(
                    current_revenue,
                    shares_outstanding,
                    net_debt,
                    revenue_growth,
                    operating_margin,
                    tax_rate,
                    capex_percent,
                    wacc,
                    growth,
                )
                row.append(f"${result['value_per_share']:,.2f}")
            except (ValueError, ZeroDivisionError):
                row.append("N/A")

        table.append(row)

    return pd.DataFrame(
        table,
        index=[f"{growth:.1%}" for growth in growth_values],
        columns=[f"{wacc:.1%}" for wacc in wacc_values],
    )


def format_money(value: float, include_unit: bool = True) -> str:
    """Format a USD value clearly, with an optional millions suffix."""
    suffix = "m" if include_unit else ""
    sign = "-" if value < 0 else ""
    return f"{sign}${abs(value):,.1f}{suffix}"


def attempt_ticker_autofill(ticker_symbol: str) -> tuple[dict[str, Any], list[str]]:
    """Try to retrieve basic annual company data without crashing the app."""
    symbol = ticker_symbol.strip().upper()
    if not symbol:
        return {}, ["Enter a ticker before clicking Autofill Basic Data."]

    warnings: list[str] = []
    retrieved: dict[str, Any] = {"ticker": symbol}

    try:
        company = yf.Ticker(symbol)
        info = company.info or {}
        retrieved["company_name"] = (
            info.get("longName") or info.get("shortName") or symbol
        )

        financials = company.financials
        revenue: float | None = None
        if not financials.empty and "Total Revenue" in financials.index:
            revenue_series = financials.loc["Total Revenue"].dropna()
            if not revenue_series.empty:
                revenue = float(revenue_series.iloc[0]) / 1_000_000
        if revenue is None:
            revenue_from_info = info.get("totalRevenue")
            if revenue_from_info is not None:
                revenue = float(revenue_from_info) / 1_000_000
        if revenue is not None:
            retrieved["revenue"] = revenue
        else:
            warnings.append("Latest annual revenue was not available.")

        shares = info.get("sharesOutstanding")
        if shares is not None:
            retrieved["shares"] = float(shares) / 1_000_000
        else:
            warnings.append("Shares outstanding were not available.")

        cash = info.get("totalCash")
        debt = info.get("totalDebt")
        if cash is not None and debt is not None:
            retrieved["net_debt"] = (float(debt) - float(cash)) / 1_000_000
        else:
            warnings.append(
                "Cash or debt was missing, so net debt could not be calculated."
            )

    except Exception:
        return {}, [
            f"We could not retrieve data for {symbol}. "
            "Check the ticker or continue with manual inputs."
        ]

    return retrieved, warnings


def initialize_state() -> None:
    """Set editable starting values for Streamlit's input widgets."""
    defaults = {
        "revenue_input": 1000.0,
        "shares_input": 100.0,
        "net_debt_input": 200.0,
        "company_name": "Manual company",
    }
    for key, value in defaults.items():
        if key not in st.session_state:
            st.session_state[key] = value


st.set_page_config(
    page_title="Interactive DCF Valuation Tool",
    page_icon="📊",
    layout="wide",
)
initialize_state()

st.title("Interactive DCF Valuation Tool")
st.caption(
    "Build a simplified five-year discounted cash flow estimate. "
    "All financial values are in **USD millions**, except value per share."
)
st.info(
    "Learning model: simplified free cash flow equals after-tax operating "
    "profit minus capital expenditure. It excludes depreciation, amortisation "
    "and changes in working capital."
)

st.subheader("1. Optional company lookup")
lookup_col, button_col = st.columns([3, 1])
with lookup_col:
    ticker = st.text_input(
        "US stock ticker",
        placeholder="For example: AAPL",
        help="Optional. Manual inputs below always remain available and editable.",
    )
with button_col:
    st.write("")
    st.write("")
    autofill_clicked = st.button("Autofill Basic Data", width="stretch")

if autofill_clicked:
    data, lookup_warnings = attempt_ticker_autofill(ticker)
    if data:
        st.session_state.company_name = data.get("company_name", ticker.upper())
        for source_key, state_key in (
            ("revenue", "revenue_input"),
            ("shares", "shares_input"),
            ("net_debt", "net_debt_input"),
        ):
            if source_key in data:
                st.session_state[state_key] = round(float(data[source_key]), 2)
        st.success(
            f"Loaded available data for {st.session_state.company_name}. "
            "Review and edit every value below."
        )
    for warning in lookup_warnings:
        st.warning(warning)

st.subheader("2. Financial information")
st.caption(f"Company: **{st.session_state.company_name}**")
financial_col1, financial_col2, financial_col3 = st.columns(3)
with financial_col1:
    current_revenue = st.number_input(
        "Current annual revenue (USD millions)",
        min_value=0.0,
        step=10.0,
        key="revenue_input",
    )
with financial_col2:
    shares_outstanding = st.number_input(
        "Shares outstanding (millions of shares)",
        min_value=0.0,
        step=1.0,
        key="shares_input",
    )
with financial_col3:
    net_debt = st.number_input(
        "Net debt (USD millions)",
        step=10.0,
        key="net_debt_input",
        help="Total debt minus total cash. Negative values represent net cash.",
    )

st.subheader("3. Valuation assumptions")
left_assumptions, right_assumptions = st.columns(2)
with left_assumptions:
    revenue_growth_percent = st.slider(
        "Annual revenue growth rate",
        -10.0,
        30.0,
        8.0,
        0.5,
        help="How quickly revenue is assumed to rise or fall each year.",
        format="%.1f%%",
    )
    operating_margin_percent = st.slider(
        "Operating margin",
        0.0,
        50.0,
        20.0,
        0.5,
        help="The percentage of revenue left as operating profit.",
        format="%.1f%%",
    )
    tax_rate_percent = st.slider(
        "Tax rate",
        0.0,
        40.0,
        21.0,
        0.5,
        help="The assumed tax rate applied to operating profit.",
        format="%.1f%%",
    )
with right_assumptions:
    capex_percent = st.slider(
        "Capital expenditure as % of revenue",
        0.0,
        20.0,
        5.0,
        0.5,
        help="The share of revenue spent on long-term assets.",
        format="%.1f%%",
    )
    wacc_percent = st.slider(
        "Discount rate / WACC",
        5.0,
        20.0,
        9.0,
        0.5,
        help="The return investors require; used to discount future cash flows.",
        format="%.1f%%",
    )
    terminal_growth_percent = st.slider(
        "Terminal growth rate",
        0.0,
        5.0,
        2.5,
        0.1,
        help="The perpetual growth rate assumed after forecast year five.",
        format="%.1f%%",
    )

calculate_clicked = st.button(
    "Calculate valuation", type="primary", width="stretch"
)

if calculate_clicked:
    if shares_outstanding <= 0:
        st.error("Shares outstanding must be greater than zero.")
        st.stop()
    if terminal_growth_percent >= wacc_percent:
        st.error("Terminal growth must be lower than WACC.")
        st.stop()

    revenue_growth = revenue_growth_percent / 100
    operating_margin = operating_margin_percent / 100
    tax_rate = tax_rate_percent / 100
    capital_expenditure_percent = capex_percent / 100
    wacc = wacc_percent / 100
    terminal_growth = terminal_growth_percent / 100

    try:
        valuation = calculate_valuation(
            current_revenue,
            shares_outstanding,
            net_debt,
            revenue_growth,
            operating_margin,
            tax_rate,
            capital_expenditure_percent,
            wacc,
            terminal_growth,
        )
    except (ValueError, ZeroDivisionError) as error:
        st.error(str(error))
        st.stop()

    st.subheader("4. Valuation results")
    result_col1, result_col2, result_col3 = st.columns(3)
    result_col1.metric(
        "Enterprise value (USD millions)",
        format_money(valuation["enterprise_value"]),
    )
    result_col2.metric(
        "Equity value (USD millions)",
        format_money(valuation["equity_value"]),
    )
    result_col3.metric(
        "Intrinsic value per share (USD)",
        format_money(valuation["value_per_share"], include_unit=False),
    )

    supporting_col1, supporting_col2, supporting_col3 = st.columns(3)
    supporting_col1.metric(
        "PV of forecast cash flows (USD millions)",
        format_money(valuation["pv_forecast"]),
    )
    supporting_col2.metric(
        "PV of terminal value (USD millions)",
        format_money(valuation["pv_terminal_value"]),
    )
    contribution = valuation["terminal_contribution"]
    supporting_col3.metric(
        "Terminal value contribution",
        f"{contribution:.1%}" if contribution is not None else "N/A",
    )
    if contribution is not None and contribution > 0.75:
        st.warning(
            "More than 75% of enterprise value comes from terminal value. "
            "The result is especially sensitive to WACC and terminal growth."
        )

    st.subheader("5. Five-year forecast")
    forecast = valuation["forecast"]
    display_forecast = forecast.copy()
    money_columns = [
        "Revenue",
        "Operating profit",
        "After-tax operating profit",
        "Capital expenditure",
        "Simplified free cash flow",
        "Present value of free cash flow",
    ]
    for column in money_columns:
        display_forecast[column] = display_forecast[column].map(
            lambda value: f"${value:,.1f}m"
        )
    display_forecast["Discount factor"] = display_forecast[
        "Discount factor"
    ].map(lambda value: f"{value:.4f}")
    st.dataframe(display_forecast, hide_index=True, width="stretch")

    st.subheader("6. Forecast charts")
    chart_col1, chart_col2 = st.columns(2)
    with chart_col1:
        revenue_chart = px.line(
            forecast,
            x="Year",
            y="Revenue",
            markers=True,
            title="Revenue forecast (USD millions)",
        )
        revenue_chart.update_traces(hovertemplate="Year %{x}<br>$%{y:,.1f}m")
        st.plotly_chart(revenue_chart, width="stretch")
    with chart_col2:
        fcf_chart = px.bar(
            forecast,
            x="Year",
            y="Simplified free cash flow",
            title="Simplified free cash flow (USD millions)",
        )
        fcf_chart.update_traces(hovertemplate="Year %{x}<br>$%{y:,.1f}m")
        st.plotly_chart(fcf_chart, width="stretch")

    st.subheader("7. Value-per-share sensitivity")
    sensitivity = generate_sensitivity_table(
        current_revenue,
        shares_outstanding,
        net_debt,
        revenue_growth,
        operating_margin,
        tax_rate,
        capital_expenditure_percent,
        wacc,
        terminal_growth,
    )
    sensitivity.index.name = "Terminal growth ↓ / WACC →"
    st.dataframe(sensitivity, width="stretch")
    st.caption(
        "Each cell is intrinsic value per share in USD. N/A means terminal "
        "growth is equal to or greater than WACC."
    )
else:
    st.caption("Set your assumptions, then select **Calculate valuation**.")

with st.expander("How the model works"):
    st.markdown(
        """
1. Revenue is forecast for five years.
2. Operating margin estimates operating profit.
3. Tax and capital expenditure are deducted to estimate simplified free cash flow.
4. Future cash flows are discounted because future money is worth less today.
5. Terminal value represents estimated cash flows after year five.
6. Net debt is deducted from enterprise value to estimate equity value.
7. Equity value is divided by shares outstanding to estimate value per share.
"""
    )

with st.expander("How assumptions affect valuation"):
    st.markdown(
        """
- Higher revenue growth and operating margins normally increase valuation.
- Higher tax rates, capital expenditure and WACC normally reduce valuation.
- Higher terminal growth normally increases valuation.
- Higher net debt reduces equity value but does not change enterprise value.
- More shares outstanding reduce intrinsic value per share.
"""
    )

with st.expander("Important limitations"):
    st.markdown(
        """
- This is a simplified educational model, not a professional investment-banking DCF.
- It assumes constant growth and margins for five years.
- It excludes depreciation, amortisation and changes in working capital.
- WACC is entered manually rather than fully calculated.
- Terminal value can represent a large part of the result.
- Data retrieved from yfinance may be missing, delayed or inconsistent.
- The output is not financial advice or an investment recommendation.
"""
    )
