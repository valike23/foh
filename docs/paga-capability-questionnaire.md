# Paga Capability Questionnaire

Use this for the CTO/vendor conversation before Phase 4 payment implementation.

## Account And Settlement

- Does Paga support virtual accounts per vendor?
- Does Paga support sub-accounts?
- Does Paga support split settlement at payment time?
- Can split rules be configured dynamically per event, venue, vendor, or store?
- Does Paga support batch payouts?
- What KYC is required for vendor-level accounts or sub-accounts?
- Who is the merchant of record in each model?

## Payment Confirmation

- What confirmation channels are available: webhook, polling API, dashboard export, terminal callback, or another method?
- Are webhook events idempotent and uniquely identified?
- Can payment confirmation be reconciled after internet loss?
- What is the expected delay for transfer confirmation?
- Can failed or abandoned payments be queried later?

## POS And Terminal Flow

- Does Paga provide a terminal SDK or API for POS transaction confirmation?
- Can a terminal payment be linked to an EXA order ID?
- Can the terminal work during intermittent internet and sync later?
- What identifiers are available on POS receipts?

## Refunds And Reversals

- Does Paga support full and partial refunds?
- Does Paga support chargeback notifications?
- Can refunds be attributed back to the original transaction and vendor/store?
- What are the refund timelines and fees?

## Operational Limits

- What are rate limits for payment creation, status checks, and webhooks?
- What are transaction limits?
- What currencies are supported for this use case?
- What sandbox environment is available?
- What production approval steps are required?

## Security And Compliance

- What PCI responsibilities remain with EXA?
- What data can EXA store locally?
- Are saved payment methods supported, and under what compliance requirements?
- What audit logs are available from Paga?

