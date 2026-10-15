# 0003: MVP Wallet And Ledger Path

## Status

Provisional.

## Decision

Build the MVP around a single wallet or settlement account plus an internal vendor ledger, unless Paga confirms that vendor sub-wallets or split settlement are practical for the first release.

## Context

EXA FOH needs to attribute revenue to vendors while supporting multiple payment methods:

- Paga online card or transfer.
- POS terminal.
- Bank transfer.
- Cash.
- Deposit or tab offsets.

The key question is whether gateway funds can be separated per vendor at payment time, or whether EXA/venue receives funds first and settles vendors later.

## MVP Default

Use one controlled wallet/account and track vendor balances internally.

The ledger should track:

- Vendor revenue.
- Deposits applied.
- Refunds.
- Platform/service fees if in MVP scope.
- Payouts.
- Manual adjustments.

## Open Compliance Note

If EXA or a venue temporarily holds vendor funds, legal and compliance review is required before production use.

## Decision Gate

Revisit this decision when Paga confirms:

- Virtual account support.
- Sub-account support.
- Split settlement support.
- Batch payout support.
- Vendor KYC requirements.

## Consequences

- Phase 4 must build a ledger before deep Paga coupling.
- The first Paga integration should keep provider references separate from internal payment IDs.
- Vendor settlement reports should be generated from ledger entries, not ad hoc payment totals.

