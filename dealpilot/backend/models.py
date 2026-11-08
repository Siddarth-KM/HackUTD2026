"""Pydantic models shared by the Gemini extraction schema, local parser and engine."""
from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field

DocType = Literal[
    "application", "guarantor_id", "certificate_of_formation", "ein_letter", "bank_statement",
    "financial_statements", "tax_return", "extension_7004", "request_letter", "equipment_quote",
    "contract_summary", "collections_notice", "other",
]


class Txn(BaseModel):
    date: Optional[str] = Field(None, description="ISO date YYYY-MM-DD")
    description: str = ""
    amount: float = Field(0.0, description="Positive number, always the absolute value")
    direction: Literal["credit", "debit", "unknown"] = "unknown"
    balance: Optional[float] = Field(None, description="Running balance after this transaction, if shown")


class ExtractedDoc(BaseModel):
    """One document's facts. Every field optional: only fill what the document actually states."""
    doc_type: DocType = "other"
    confidence: float = 0.5
    legible: bool = True
    signed: Optional[bool] = Field(None, description="Application only: is there a signature line filled in (e.g. /s/ Name)")
    notes: str = ""
    # business
    legal_name: Optional[str] = None
    dba: Optional[str] = None
    ein: Optional[str] = Field(None, description="Format NN-NNNNNNN")
    entity_type: Optional[str] = None
    formation_date: Optional[str] = None
    business_address: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    industry: Optional[str] = None
    naics: Optional[str] = None
    employees: Optional[int] = None
    annual_revenue: Optional[float] = None
    primary_bank: Optional[str] = Field(None, description="Bank name only, e.g. First Lakes Bank")
    primary_account_last4: Optional[str] = Field(None, description="Last 4 digits of the primary account as printed on the application (e.g. ...6638 -> 6638)")
    # request
    amount_requested: Optional[float] = None
    product: Optional[str] = Field(None, description="One of: Term Loan, Equipment Loan, Revolving Line of Credit, Working Capital Loan")
    purpose: Optional[str] = None
    purpose_category: Optional[Literal["working_capital", "equipment", "inventory", "payroll", "expansion", "refinance"]] = None
    term_months: Optional[int] = None
    collateral: Optional[str] = None
    needed_by: Optional[str] = Field(None, description="ISO datetime if a funds-needed-by date is stated, else null")
    # guarantor / ID
    guarantor_name: Optional[str] = None
    guarantor_dob: Optional[str] = None
    guarantor_ssn4: Optional[str] = None
    guarantor_address: Optional[str] = None
    guarantor_dl: Optional[str] = Field(None, description="Driver license number, digits only (drop any state prefix like TX)")
    affiliated_businesses: Optional[str] = None
    # state filing
    file_number: Optional[str] = None
    registered_agent: Optional[str] = None
    registered_agent_address: Optional[str] = None
    organizer: Optional[str] = None
    # preparer
    preparer_name: Optional[str] = None
    preparer_firm: Optional[str] = None
    preparer_phone: Optional[str] = None
    preparer_ptin: Optional[str] = None
    # financials / tax
    fy_revenue: Optional[float] = None
    ytd_revenue: Optional[float] = None
    net_income: Optional[float] = None
    total_liabilities: Optional[float] = None
    cash_balance: Optional[float] = Field(None, description="Balance sheet: Cash line")
    balance_sheet_date: Optional[str] = None
    gross_receipts: Optional[float] = None
    tax_year: Optional[int] = None
    # bank statement
    bank_name: Optional[str] = None
    account_last4: Optional[str] = None
    period_start: Optional[str] = None
    period_end: Optional[str] = None
    opening_balance: Optional[float] = None
    total_deposits: Optional[float] = None
    total_withdrawals: Optional[float] = None
    closing_balance: Optional[float] = None
    pages_seen: list[int] = Field(default_factory=list, description='"Page X of N" markers: the X values found')
    pages_expected: Optional[int] = Field(None, description='"Page X of N": the N')
    transactions: list[Txn] = Field(default_factory=list)
    # equipment quote
    vendor_name: Optional[str] = None
    vendor_address: Optional[str] = None
    vendor_phone: Optional[str] = None
    vendor_bank: Optional[str] = None
    vendor_routing: Optional[str] = None
    vendor_account_last4: Optional[str] = None
    quote_total: Optional[float] = None
    # contract summary / collections
    contract_currencies: list[str] = Field(default_factory=list)
    subject_name: Optional[str] = Field(None, description="Collections notice: which borrower it concerns")
    notice_text: Optional[str] = None


class BatchResult(BaseModel):
    """Gemini batch extraction: one ExtractedDoc per input document, same order."""
    documents: list[ExtractedDoc]
