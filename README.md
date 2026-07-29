# Interactive DCF Valuation Tool

An educational, beginner-friendly discounted cash flow calculator built with
Python and Streamlit. Enter a few financial figures and assumptions to forecast
five years of revenue and simplified free cash flow, discount those cash flows,
estimate terminal value, and calculate intrinsic value per share.

This project is designed to teach the structure of a DCF. It is intentionally
simpler than a professional investment-banking or equity-research model.

## Features

- Manual inputs that always remain editable
- Optional US ticker lookup with `yfinance`
- Five-year revenue and simplified free-cash-flow forecast
- Gordon Growth terminal value
- Enterprise value, equity value, and intrinsic value per share
- Terminal-value contribution warning
- Interactive Plotly revenue and cash-flow charts
- 5-by-5 WACC and terminal-growth sensitivity table
- Clear input validation and educational explanations

## Inputs and units

Financial inputs:

- Current annual revenue — USD millions
- Shares outstanding — millions of shares
- Net debt — USD millions; negative values represent net cash

User-controlled assumptions:

- Annual revenue growth
- Operating margin
- Tax rate
- Capital expenditure as a percentage of revenue
- Discount rate / WACC
- Terminal growth rate

The optional ticker lookup only attempts to fill company name, latest annual
revenue, shares outstanding, total cash, and total debt. It calculates net debt
as total debt minus total cash. It never guesses valuation assumptions.

## Outputs

- Enterprise value — USD millions
- Equity value — USD millions
- Intrinsic value per share — USD
- Present value of forecast free cash flows — USD millions
- Present value of terminal value — USD millions
- Terminal value as a percentage of enterprise value
- Five-year forecast table and charts
- Value-per-share sensitivity table

Because equity value and shares outstanding are both stated in millions, the
millions cancel when calculating value per share.

## Formulas used

For each of years 1 through 5:

```text
Revenue = Previous year revenue × (1 + revenue growth)
Operating profit = Revenue × operating margin
After-tax operating profit = Operating profit × (1 - tax rate)
Capital expenditure = Revenue × capital expenditure %
Simplified free cash flow = After-tax operating profit - capital expenditure
Discount factor = 1 / (1 + WACC) ^ year
Present value of FCF = Simplified FCF × discount factor
```

Terminal value uses the Gordon Growth method:

```text
Terminal value = Year 5 FCF × (1 + terminal growth) /
                 (WACC - terminal growth)

Present value of terminal value = Terminal value / (1 + WACC) ^ 5
Enterprise value = Sum of discounted FCF + PV of terminal value
Equity value = Enterprise value - net debt
Intrinsic value per share = Equity value / shares outstanding
```

Terminal growth must be lower than WACC. Shares outstanding must be greater
than zero.

## Simplifications and limitations

The model uses after-tax operating profit minus capital expenditure as a
**simplified free-cash-flow proxy**. It excludes depreciation, amortisation,
changes in working capital, stock-based compensation, acquisitions, leases,
and other adjustments that may matter in a full DCF.

It also assumes constant growth and margins for five years, accepts a manually
entered WACC, and can derive a large portion of enterprise value from terminal
value. Data from `yfinance` may be missing, delayed, or inconsistent.

## Installation

Python 3.10 or newer is recommended. In a terminal, open this project folder
and run:

```bash
pip install -r requirements.txt
```

## Run the app

```bash
streamlit run app.py
```

Streamlit will print a local address. Open it in your browser.

## Example manual inputs

Try these illustrative values:

| Input | Example |
| --- | ---: |
| Current revenue | $1,000 million |
| Shares outstanding | 100 million |
| Net debt | $200 million |
| Revenue growth | 8.0% |
| Operating margin | 20.0% |
| Tax rate | 21.0% |
| Capital expenditure / revenue | 5.0% |
| WACC | 9.0% |
| Terminal growth | 2.5% |

Change one assumption at a time to see how it affects the result.

## Optional ticker autofill

Enter a valid US stock ticker, such as `AAPL`, and select **Autofill Basic
Data**. The app asks Yahoo Finance through `yfinance` for available company
information. Retrieved values are converted into millions and placed in the
normal editable input fields.

If the lookup fails or a value is missing, the app shows a friendly warning.
You can always continue with manual inputs.

## Code walkthrough

`forecast_financials()` compounds revenue for five years and derives operating
profit, after-tax operating profit, capital expenditure, and simplified free
cash flow.

`discount_cash_flows()` calculates a discount factor for each year. A dollar in
the future is worth less than a dollar today, so each future cash flow is
multiplied by a factor below one.

`calculate_terminal_value()` estimates all cash flows after year five with the
Gordon Growth formula. It rejects terminal growth that is equal to or greater
than WACC, because that would make the formula invalid or economically
unreasonable.

`calculate_valuation()` brings the forecast together. It adds the present value
of the five forecast cash flows and terminal value to get enterprise value,
subtracts net debt for equity value, and divides by shares for value per share.

`generate_sensitivity_table()` repeats the valuation across nearby WACC and
terminal-growth assumptions. This shows how much the answer depends on two of
the most sensitive DCF inputs.

`attempt_ticker_autofill()` contains the optional automation. It handles
missing fields and lookup errors so the manual calculator keeps working.

The final part of `app.py` creates the Streamlit interface: inputs first,
results next, then tables, charts, explanations, and limitations.

## What I learned from building it

- A DCF converts forecasts into a present-day value.
- Small WACC or terminal-growth changes can materially change valuation.
- Terminal value often makes up most of enterprise value.
- Consistent units prevent subtle errors.
- Input validation is part of the financial model, not just the interface.
- Automated financial data should be reviewed rather than trusted blindly.

## Disclaimer

This project is for education only. It is not financial advice, investment
research, or a recommendation to buy, hold, or sell any security. Verify all
inputs and consult qualified professionals before making financial decisions.
