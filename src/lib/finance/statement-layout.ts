import type { LineItemKey, StatementKind } from './statement-types';

export type LineFormat = 'money' | 'perShare' | 'shares' | 'percent';

export type LineDef = {
  key: LineItemKey;
  label: string;
  format?: LineFormat;
  primary?: boolean;
  indent?: 0 | 1 | 2;
  /** Starts a new group in tables. */
  section?: string;
  /** Plain-language definition shown in the detail view. */
  meaning: string;
  /** Is an increase good news? Drives the tone of change chips. */
  better?: 'higher' | 'lower' | 'neutral';
};

const INCOME: LineDef[] = [
  { key: 'revenue', label: 'Revenue', primary: true, section: 'Top line', meaning: 'Everything customers paid for goods and services in the period, before any costs.' },
  { key: 'costOfRevenue', label: 'Cost of revenue', indent: 1, better: 'lower', meaning: 'Direct costs of producing what was sold: materials, manufacturing, hosting, delivery.' },
  { key: 'grossProfit', label: 'Gross profit', primary: true, meaning: 'Revenue minus direct costs. Shows pricing power and production economics.' },
  { key: 'researchAndDevelopment', label: 'Research & development', indent: 1, section: 'Operating costs', better: 'neutral', meaning: 'Spending on new products and technology, expensed as incurred.' },
  { key: 'sellingGeneralAdministrative', label: 'Selling, general & admin', indent: 1, better: 'lower', meaning: 'Sales, marketing, corporate overhead and administration.' },
  { key: 'totalOperatingExpenses', label: 'Total operating expenses', better: 'lower', meaning: 'All operating costs below gross profit.' },
  { key: 'operatingIncome', label: 'Operating income', primary: true, meaning: 'Profit from the core business before interest and taxes (EBIT).' },
  { key: 'ebitda', label: 'EBITDA', indent: 1, meaning: 'Operating income with depreciation and amortization added back; a rough proxy for operating cash earnings.' },
  { key: 'interestExpense', label: 'Interest expense', section: 'Below the line', indent: 1, better: 'lower', meaning: 'Cost of the company’s borrowings.' },
  { key: 'pretaxIncome', label: 'Pre-tax income', primary: true, meaning: 'Profit after interest and non-operating items, before income tax.' },
  { key: 'taxExpense', label: 'Income tax', indent: 1, better: 'lower', meaning: 'Tax charged on the period’s profit (can include one-off items).' },
  { key: 'netIncome', label: 'Net income', primary: true, meaning: 'Bottom-line profit attributable to shareholders.' },
  { key: 'epsDiluted', label: 'Diluted EPS', format: 'perShare', section: 'Per share', meaning: 'Net income divided by diluted shares, including options and convertibles.' },
  { key: 'sharesDiluted', label: 'Diluted shares', format: 'shares', better: 'lower', meaning: 'Average diluted share count. Falling means buybacks; rising means dilution.' },
  { key: 'grossMargin', label: 'Gross margin', format: 'percent', section: 'Margins', meaning: 'Gross profit as a share of revenue.' },
  { key: 'operatingMargin', label: 'Operating margin', format: 'percent', meaning: 'Operating income as a share of revenue.' },
  { key: 'netMargin', label: 'Net margin', format: 'percent', meaning: 'Net income as a share of revenue.' },
];

const BANK_INCOME: LineDef[] = [
  { key: 'totalInterestIncome', label: 'Interest income', section: 'Lending', meaning: 'Interest earned on loans, securities and other interest-bearing assets.' },
  { key: 'interestExpense', label: 'Interest expense', indent: 1, better: 'lower', meaning: 'Interest paid on deposits and borrowings.' },
  { key: 'netInterestIncome', label: 'Net interest income', primary: true, meaning: 'Interest earned minus interest paid: the core earnings engine of a bank.' },
  { key: 'nonInterestIncome', label: 'Non-interest income', section: 'Fees & other', meaning: 'Fees, trading, advisory, card and wealth-management income.' },
  { key: 'revenue', label: 'Total revenue', primary: true, meaning: 'Net interest income plus non-interest income.' },
  { key: 'provisionForCreditLosses', label: 'Credit loss provision', section: 'Costs', better: 'lower', meaning: 'Money set aside for loans expected to go bad.' },
  { key: 'nonInterestExpense', label: 'Non-interest expense', better: 'lower', meaning: 'Salaries, technology, premises and other operating costs.' },
  { key: 'pretaxIncome', label: 'Pre-tax income', primary: true, meaning: 'Profit before income tax.' },
  { key: 'taxExpense', label: 'Income tax', indent: 1, better: 'lower', meaning: 'Tax charged on the period’s profit.' },
  { key: 'netIncome', label: 'Net income', primary: true, meaning: 'Bottom-line profit attributable to shareholders.' },
  { key: 'epsDiluted', label: 'Diluted EPS', format: 'perShare', section: 'Per share', meaning: 'Net income per diluted share.' },
  { key: 'sharesDiluted', label: 'Diluted shares', format: 'shares', better: 'lower', meaning: 'Average diluted share count.' },
  { key: 'netMargin', label: 'Net margin', format: 'percent', section: 'Margins', meaning: 'Net income as a share of total revenue.' },
];

const BALANCE: LineDef[] = [
  { key: 'cash', label: 'Cash & equivalents', indent: 1, section: 'Current assets', meaning: 'Cash and instruments that can be turned into cash almost immediately.' },
  { key: 'shortTermInvestments', label: 'Short-term investments', indent: 1, meaning: 'Marketable securities maturing within a year.' },
  { key: 'receivables', label: 'Receivables', indent: 1, better: 'neutral', meaning: 'Money customers owe for goods and services already delivered.' },
  { key: 'inventory', label: 'Inventory', indent: 1, better: 'neutral', meaning: 'Goods and materials not yet sold.' },
  { key: 'otherCurrentAssets', label: 'Other current assets', indent: 1, meaning: 'Prepaid expenses and other short-term assets.' },
  { key: 'currentAssets', label: 'Total current assets', meaning: 'Assets expected to turn into cash within a year.' },
  { key: 'propertyPlantEquipment', label: 'Property, plant & equipment', indent: 1, section: 'Long-term assets', meaning: 'Physical assets net of depreciation.' },
  { key: 'goodwill', label: 'Goodwill', indent: 1, better: 'neutral', meaning: 'Premium paid over book value in acquisitions.' },
  { key: 'intangibleAssets', label: 'Intangible assets', indent: 1, meaning: 'Patents, brands, customer relationships and other acquired intangibles.' },
  { key: 'longTermInvestments', label: 'Long-term investments', indent: 1, meaning: 'Securities and stakes held for more than a year.' },
  { key: 'nonCurrentAssets', label: 'Total long-term assets', meaning: 'All assets not expected to become cash within a year.' },
  { key: 'totalAssets', label: 'Total assets', primary: true, meaning: 'Everything the company owns.' },
  { key: 'accountsPayable', label: 'Accounts payable', indent: 1, section: 'Current liabilities', better: 'neutral', meaning: 'Bills owed to suppliers.' },
  { key: 'accruedLiabilities', label: 'Accrued liabilities', indent: 1, better: 'neutral', meaning: 'Expenses incurred but not yet paid (wages, taxes, interest).' },
  { key: 'deferredRevenue', label: 'Deferred revenue', indent: 1, better: 'neutral', meaning: 'Cash received for products or services still to be delivered.' },
  { key: 'shortTermDebt', label: 'Short-term debt', indent: 1, better: 'lower', meaning: 'Borrowings due within a year, including the current part of long-term debt.' },
  { key: 'currentLiabilities', label: 'Total current liabilities', better: 'lower', meaning: 'Obligations due within a year.' },
  { key: 'longTermDebt', label: 'Long-term debt', indent: 1, section: 'Long-term liabilities', better: 'lower', meaning: 'Borrowings due after more than a year.' },
  { key: 'nonCurrentLiabilities', label: 'Total long-term liabilities', better: 'lower', meaning: 'Obligations due after more than a year.' },
  { key: 'totalLiabilities', label: 'Total liabilities', primary: true, better: 'lower', meaning: 'Everything the company owes.' },
  { key: 'commonStockAndApic', label: 'Paid-in capital', indent: 1, section: 'Equity', meaning: 'Money shareholders put in by buying newly issued stock.' },
  { key: 'retainedEarnings', label: 'Retained earnings', indent: 1, meaning: 'Cumulative profits kept in the business rather than paid out.' },
  { key: 'treasuryStock', label: 'Treasury stock', indent: 1, better: 'neutral', meaning: 'Shares the company bought back and holds.' },
  { key: 'accumulatedOci', label: 'Other comprehensive income', indent: 1, meaning: 'Unrealized gains and losses (currency, securities, pensions) not yet in net income.' },
  { key: 'totalEquity', label: 'Shareholders’ equity', primary: true, meaning: 'Assets minus liabilities: the book value owned by shareholders.' },
  { key: 'preferredStock', label: 'Preferred stock', indent: 1, better: 'neutral', meaning: 'Shares with a fixed claim ahead of common shareholders, including redeemable preferred.' },
  { key: 'minorityInterest', label: 'Minority interest', indent: 1, better: 'neutral', meaning: 'The part of subsidiaries owned by outside shareholders.' },
  { key: 'totalDebt', label: 'Total debt', section: 'Debt', better: 'lower', meaning: 'Short-term plus long-term borrowings.' },
  { key: 'leaseLiabilities', label: 'Lease liabilities', better: 'lower', meaning: 'Operating and finance lease obligations: debt-like payments for leased property and equipment.' },
  { key: 'netDebt', label: 'Net debt', better: 'lower', meaning: 'Total debt minus cash. Negative means net cash.' },
];

const BANK_BALANCE: LineDef[] = [
  { key: 'cash', label: 'Cash & due from banks', indent: 1, section: 'Assets', meaning: 'Cash and balances held at other banks and the central bank.' },
  { key: 'loans', label: 'Net loans', indent: 1, meaning: 'Loans outstanding after the allowance for expected losses.' },
  { key: 'longTermInvestments', label: 'Investment securities', indent: 1, meaning: 'Bonds and other securities held for income or liquidity.' },
  { key: 'goodwill', label: 'Goodwill', indent: 1, meaning: 'Premium paid over book value in acquisitions.' },
  { key: 'totalAssets', label: 'Total assets', primary: true, meaning: 'Everything the bank owns.' },
  { key: 'deposits', label: 'Deposits', indent: 1, section: 'Liabilities', meaning: 'Customer deposits: the bank’s main source of funding.' },
  { key: 'shortTermDebt', label: 'Short-term borrowings', indent: 1, meaning: 'Borrowings due within a year.' },
  { key: 'longTermDebt', label: 'Long-term debt', indent: 1, meaning: 'Borrowings due after more than a year.' },
  { key: 'totalLiabilities', label: 'Total liabilities', primary: true, better: 'lower', meaning: 'Everything the bank owes.' },
  { key: 'retainedEarnings', label: 'Retained earnings', indent: 1, section: 'Equity', meaning: 'Cumulative profits kept in the business.' },
  { key: 'totalEquity', label: 'Shareholders’ equity', primary: true, meaning: 'Book value owned by shareholders.' },
];

const CASH_FLOW: LineDef[] = [
  { key: 'netIncome', label: 'Net income', section: 'Operating activities', meaning: 'Starting point: profit for the period.' },
  { key: 'depreciationAmortization', label: 'Depreciation & amortization', indent: 1, meaning: 'Non-cash charge for using up long-lived assets, added back.' },
  { key: 'stockBasedCompensation', label: 'Stock-based compensation', indent: 1, better: 'lower', meaning: 'Pay in shares instead of cash: added back, but it dilutes owners.' },
  { key: 'deferredTaxes', label: 'Deferred taxes', indent: 1, meaning: 'Tax expense not yet paid in cash (or paid ahead).' },
  { key: 'changeInReceivables', label: 'Change in receivables', indent: 2, meaning: 'Cash tied up (negative) or released (positive) by customer balances.' },
  { key: 'changeInInventory', label: 'Change in inventory', indent: 2, meaning: 'Cash tied up (negative) or released (positive) by inventory.' },
  { key: 'changeInPayables', label: 'Change in payables', indent: 2, meaning: 'Cash retained (positive) or paid down (negative) through supplier balances.' },
  { key: 'operatingCashFlow', label: 'Operating cash flow', primary: true, meaning: 'Cash generated by running the business.' },
  { key: 'capex', label: 'Capital expenditures', section: 'Investing activities', better: 'neutral', meaning: 'Cash spent on property, plant, equipment and capitalized software.' },
  { key: 'acquisitions', label: 'Acquisitions', indent: 1, better: 'neutral', meaning: 'Cash paid for businesses, net of cash acquired.' },
  { key: 'purchasesOfInvestments', label: 'Investments purchased', indent: 1, better: 'neutral', meaning: 'Cash put into securities.' },
  { key: 'salesOfInvestments', label: 'Investments sold or matured', indent: 1, better: 'neutral', meaning: 'Cash received from selling or redeeming securities.' },
  { key: 'investingCashFlow', label: 'Investing cash flow', primary: true, better: 'neutral', meaning: 'Net cash used for (negative) or raised from (positive) investments.' },
  { key: 'freeCashFlow', label: 'Free cash flow', primary: true, section: 'Free cash flow', meaning: 'Operating cash flow minus capital expenditures: cash available to owners.' },
  { key: 'dividendsPaid', label: 'Dividends paid', section: 'Financing activities', better: 'neutral', meaning: 'Cash returned to shareholders as dividends.' },
  { key: 'buybacks', label: 'Share buybacks', indent: 1, better: 'neutral', meaning: 'Cash spent repurchasing the company’s own shares.' },
  { key: 'stockIssued', label: 'Stock issued', indent: 1, better: 'neutral', meaning: 'Cash raised by issuing shares (including option exercises).' },
  { key: 'debtIssued', label: 'Debt issued', indent: 1, better: 'neutral', meaning: 'Cash raised by borrowing.' },
  { key: 'debtRepaid', label: 'Debt repaid', indent: 1, better: 'neutral', meaning: 'Cash used to repay borrowings.' },
  { key: 'financingCashFlow', label: 'Financing cash flow', primary: true, better: 'neutral', meaning: 'Net cash exchanged with shareholders and lenders.' },
  { key: 'fxEffect', label: 'FX effect on cash', section: 'Reconciliation', indent: 1, meaning: 'Currency translation effect on cash balances.' },
  { key: 'netChangeInCash', label: 'Net change in cash', primary: true, better: 'neutral', meaning: 'Sum of operating, investing and financing cash flows (and FX).' },
];

export function statementLayout(kind: StatementKind, isBank: boolean): LineDef[] {
  if (kind === 'income') return isBank ? BANK_INCOME : INCOME;
  if (kind === 'balance') return isBank ? BANK_BALANCE : BALANCE;
  return CASH_FLOW;
}

export const STATEMENT_TITLES: Record<StatementKind, string> = {
  income: 'Income statement',
  balance: 'Balance sheet',
  cashflow: 'Cash flow',
};

/** Which rows lead the snapshot (Nestor-style "featured" metrics, first four with data). */
export const FEATURED: Record<StatementKind, LineItemKey[]> = {
  income: ['revenue', 'grossProfit', 'operatingIncome', 'netIncome', 'epsDiluted'],
  balance: ['totalAssets', 'totalLiabilities', 'totalEquity', 'cash', 'totalDebt'],
  cashflow: ['operatingCashFlow', 'capex', 'freeCashFlow', 'dividendsPaid', 'buybacks'],
};
