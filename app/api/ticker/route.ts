import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

type SecUnit = {
  end?: string;
  filed?: string;
  form?: string;
  fp?: string;
  start?: string;
  val?: number;
};

type SecFact = {
  units?: Record<string, SecUnit[]>;
};

type SecFacts = Record<string, Record<string, SecFact>>;

const SEC_HEADERS = {
  Accept: "application/json",
  "User-Agent": "DCF-Lab educational valuation tool support@example.com",
};

function selectLatest(
  fact: SecFact | undefined,
  unit: "USD" | "shares",
  annualDuration: boolean,
) {
  const candidates = (fact?.units?.[unit] ?? [])
    .filter(
      (item) =>
        item.form === "10-K" &&
        typeof item.val === "number" &&
        (!annualDuration || (item.start && item.end)),
    )
    .filter((item) => {
      if (!annualDuration || !item.start || !item.end) return true;
      const duration =
        new Date(item.end).getTime() - new Date(item.start).getTime();
      return duration > 300 * 24 * 60 * 60 * 1000;
    })
    .sort((left, right) => {
      const endComparison = (left.end ?? "").localeCompare(right.end ?? "");
      if (endComparison !== 0) return endComparison;
      return (left.filed ?? "").localeCompare(right.filed ?? "");
    });

  return candidates.at(-1)?.val;
}

function selectMostRecentAcrossTags(
  facts: SecFacts,
  namespace: string,
  tags: string[],
  unit: "USD" | "shares",
  annualDuration = false,
) {
  const candidates = tags.flatMap((tag) =>
    (facts[namespace]?.[tag]?.units?.[unit] ?? [])
      .filter(
        (item) =>
          item.form === "10-K" &&
          typeof item.val === "number" &&
          (!annualDuration || (item.start && item.end)),
      )
      .filter((item) => {
        if (!annualDuration || !item.start || !item.end) return true;
        const duration =
          new Date(item.end).getTime() - new Date(item.start).getTime();
        return duration > 300 * 24 * 60 * 60 * 1000;
      }),
  );

  candidates.sort((left, right) => {
    const endComparison = (left.end ?? "").localeCompare(right.end ?? "");
    if (endComparison !== 0) return endComparison;
    return (left.filed ?? "").localeCompare(right.filed ?? "");
  });

  return candidates.at(-1)?.val;
}

function firstAvailableFact(
  facts: SecFacts,
  namespace: string,
  tags: string[],
  unit: "USD" | "shares",
  annualDuration = false,
) {
  for (const tag of tags) {
    const value = selectLatest(
      facts[namespace]?.[tag],
      unit,
      annualDuration,
    );
    if (value !== undefined) return value;
  }
  return undefined;
}

function readDebt(facts: SecFacts) {
  const gaap = facts["us-gaap"] ?? {};
  const pairs = [
    [
      "LongTermDebtAndFinanceLeaseObligationsCurrent",
      "LongTermDebtAndFinanceLeaseObligationsNoncurrent",
    ],
    ["LongTermDebtCurrent", "LongTermDebtNoncurrent"],
  ];

  for (const [currentTag, noncurrentTag] of pairs) {
    const current = selectLatest(gaap[currentTag], "USD", false);
    const noncurrent = selectLatest(gaap[noncurrentTag], "USD", false);
    if (current !== undefined || noncurrent !== undefined) {
      return (current ?? 0) + (noncurrent ?? 0);
    }
  }

  return firstAvailableFact(
    facts,
    "us-gaap",
    ["LongTermDebt", "DebtCurrent"],
    "USD",
  );
}

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams
    .get("symbol")
    ?.trim()
    .toUpperCase();

  if (!symbol || !/^[A-Z0-9.-]{1,10}$/.test(symbol)) {
    return NextResponse.json(
      { warning: "Enter a valid US stock ticker." },
      { status: 400 },
    );
  }

  try {
    const tickerResponse = await fetch(
      "https://www.sec.gov/files/company_tickers.json",
      { headers: SEC_HEADERS },
    );
    if (!tickerResponse.ok) throw new Error("Ticker list was unavailable.");

    const tickerMap = (await tickerResponse.json()) as Record<
      string,
      { cik_str: number; ticker: string; title: string }
    >;
    const company = Object.values(tickerMap).find(
      (entry) => entry.ticker.toUpperCase() === symbol,
    );
    if (!company) throw new Error("Ticker was not found in SEC filings.");

    const cik = String(company.cik_str).padStart(10, "0");
    const factsResponse = await fetch(
      `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`,
      { headers: SEC_HEADERS },
    );
    if (!factsResponse.ok) throw new Error("Company facts were unavailable.");

    const payload = (await factsResponse.json()) as {
      entityName?: string;
      facts?: SecFacts;
    };
    const facts = payload.facts ?? {};

    // Companies sometimes move between valid SEC revenue tags over time.
    // Compare filing dates across all tags so an older tag is never preferred.
    const revenue = selectMostRecentAcrossTags(
      facts,
      "us-gaap",
      [
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "Revenues",
        "SalesRevenueNet",
      ],
      "USD",
      true,
    );
    const shares = firstAvailableFact(
      facts,
      "dei",
      ["EntityCommonStockSharesOutstanding"],
      "shares",
    );
    const cash = firstAvailableFact(
      facts,
      "us-gaap",
      [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
      ],
      "USD",
    );
    const debt = readDebt(facts);
    const missing = [
      revenue === undefined ? "revenue" : "",
      shares === undefined ? "shares outstanding" : "",
      cash === undefined || debt === undefined ? "cash or debt" : "",
    ].filter(Boolean);

    return NextResponse.json({
      companyName: payload.entityName || company.title || symbol,
      revenue: revenue === undefined ? undefined : revenue / 1_000_000,
      shares: shares === undefined ? undefined : shares / 1_000_000,
      netDebt:
        cash === undefined || debt === undefined
          ? undefined
          : (debt - cash) / 1_000_000,
      warning:
        missing.length > 0
          ? `Loaded available SEC filing data. Missing: ${missing.join(", ")}.`
          : "Loaded the latest available annual SEC filing data. Review every value before calculating.",
    });
  } catch {
    return NextResponse.json(
      {
        warning:
          `We could not retrieve filing data for ${symbol}. ` +
          "Check the ticker or continue with manual inputs.",
      },
      { status: 502 },
    );
  }
}
