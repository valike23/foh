# Phase 4: Payments, Confirmations, And Ledger

## Goal

Make all payment paths auditable, reconcilable, and attributable to vendors.

## Product Outcome

Every payment, whether online, POS, transfer, or cash, creates a consistent payment record and ledger trail that supports vendor settlement.

## Build Scope

- Payment confirmation model.
- Paga adapter boundary.
- Pending-network handling.
- Manual transfer confirmation.
- POS confirmation workflow.
- Cash confirmation and register reconciliation.
- Vendor ledger accounts.
- Ledger entries.
- Settlement reporting.

## Implementation Status

Implemented in the local MVP hub and BOH dashboard.

- Shared models now include `PaymentConfirmation`, `PaymentProviderEvent`, `RegisterSession`, `VendorLedgerAccount`, `LedgerEntry`, `SettlementBatch`, and `Payout`.
- The hub persists the new finance collections in SQLite and backfills vendor ledger accounts for seeded or existing vendors.
- Manual cash, POS, bank transfer, deposit offset, and pending Paga payments create confirmation records.
- Confirmed/manual payments create idempotent vendor ledger credits.
- Paga provider events can be received through a provider boundary and confirm pending payments without duplicating ledger entries.
- Settlement reports are generated from ledger entries, not from raw order totals.
- Admins can draft settlement batches and mark payouts paid, which creates vendor ledger debits.
- Cash payments automatically open a register session; admins/cashiers can close registers with expected, declared, and variance amounts.
- The BOH dashboard has a Phase 4 ledger and settlement console for reports, batches, payouts, register close-out, recent confirmations, and ledger activity.

## Payment Methods

- Paga online card or transfer.
- POS terminal.
- Offline bank transfer.
- Cash.
- Deposit or tab offset.

## Confirmation Sources

- Gateway confirmed.
- POS SDK confirmed later.
- Staff confirmed transfer.
- Staff confirmed POS.
- Staff confirmed cash.
- System-applied deposit coverage.

## Data Model Work

- `PaymentConfirmation`.
- `PaymentProviderEvent`.
- `RegisterSession`.
- `VendorLedgerAccount`.
- `LedgerEntry`.
- `SettlementBatch`.
- `Payout`.
- `Refund`.
- `Chargeback` later if needed.

## Ledger Scope

- Vendor revenue.
- Platform charges and fees if in MVP scope.
- Taxes or service charges where applicable.
- Deposits applied.
- Refunds.
- Payouts.
- Manual adjustments with audit.

## Paga Integration Boundary

- Keep provider-specific code behind an adapter.
- Store provider references separately from internal payment IDs.
- Make confirmation idempotent.
- Queue confirmation checks when internet is unavailable.
- Do not block cash/offline flows when Paga is unavailable.

## UI Work

- Payment confirmation panel.
- Transfer confirmation queue.
- POS confirmation screen.
- Cash drawer summary.
- Payment detail/audit view.
- Vendor settlement report.
- Admin payment reconciliation view.

## API Work

- Create payment intent for online method.
- Receive Paga callback/webhook later.
- Poll or reconcile payment status.
- Confirm manual transfer/POS/cash.
- Generate ledger entries from payment events.
- Reverse/refund payment where supported.
- Produce settlement report.

Implemented local endpoints:

- `POST /api/payments`
- `POST /api/payments/provider-events/paga`
- `GET /api/ledger/entries`
- `GET /api/reports/settlement`
- `POST /api/settlement-batches`
- `POST /api/settlement-batches/:batchId/payout`
- `PATCH /api/register-sessions/:registerId/close`

Deferred past this phase:

- Real Paga hosted checkout or SDK payment intent creation.
- Refund and chargeback workflows.
- Platform fee/tax liability sub-ledgers.
- Bank payout automation and compliance review.

## Verification

- Each payment method creates a `Payment`.
- Each settled payment creates ledger entries.
- Manual confirmations record actor, time, method, and notes.
- Duplicate gateway callbacks do not duplicate ledger entries.
- Cash expected vs declared vs actual can be reconciled.
- Vendor settlement report can be regenerated from ledger entries.

## Decision Gate

- If Paga supports sub-wallets or split settlement and vendor KYC is acceptable, evaluate vendor sub-wallets.
- If not, continue with single wallet plus internal ledger.

## Risks

- Payment bugs have financial consequences; idempotency matters.
- Manual confirmations need strong audit trails.
- Ledger model must be simple enough for MVP but not disposable.
- Compliance review is required if EXA or venue temporarily holds vendor funds.

## Exit Criteria

- All MVP payment methods are represented consistently.
- Ledger is the source for vendor settlement reporting.
- Paga downtime does not stop offline operations.
- Admin can reconcile payments and cash locally.
- Vendor balances are explainable from ledger entries.
