# Phase 0: Product Decisions And Technical Baseline

## Goal

Settle the product and architecture decisions that affect every later phase, while keeping the current local demo stable and runnable.

## Implementation Status

Phase 0 is implemented as the current baseline. The architectural defaults are documented, and the remaining CTO/vendor questions are explicit decision gates for later phases.

## Current Baseline

- Next.js + Tailwind BOH dashboard exists.
- Next.js + Tailwind guest QR ordering exists.
- Local hub API exists.
- Local SQLite persistence exists.
- Shared order, charge, deposit, inventory, and payment types exist.
- The product direction now includes both events and fixed venues.
- Runtime baseline and implementation notes are tracked in [../phase-0-baseline.md](../phase-0-baseline.md).

## Decisions To Make

- Use one unified `OperatingUnit` model for events and venues, or split them into separate top-level models. Current default: unified model.
- Keep the local hub on SQLite and use Postgres for cloud platform storage. Current decision: accepted for MVP.
- Confirm whether the MVP wallet path is single wallet plus internal ledger, or vendor sub-wallets. Current default: single wallet plus internal ledger.
- Confirm whether MVP ledger includes commission calculation or only vendor balance reporting.
- Confirm which fixed-venue subtype ships first: bar/restaurant/club, arena, food hall, or another model.
- Confirm Paga capabilities before deep payment architecture work.

Working decision records:

- [Unified Operating Unit](../decisions/0001-unified-operating-unit.md)
- [Local SQLite And Cloud Postgres](../decisions/0002-local-sqlite-cloud-postgres.md)
- [MVP Wallet And Ledger Path](../decisions/0003-mvp-wallet-and-ledger-path.md)

## Paga Questions

- Does Paga support virtual accounts per vendor?
- Does Paga support sub-accounts or split settlement?
- Does Paga support terminal SDK confirmation for POS payments?
- Does Paga support batch payouts?
- Can gateway payment confirmation be safely queued and reconciled after internet returns?
- What KYC is required for vendors if using vendor-level accounts?

Expanded questionnaire: [../paga-capability-questionnaire.md](../paga-capability-questionnaire.md).

## Build Scope

- Keep existing apps bootable with `npm run dev`.
- Keep SQLite persistence as the local appliance store.
- Keep seed/demo data aligned with both event and venue language.
- Document all open CTO/product decisions in the plan.
- Avoid deep schema renaming until the unified model is confirmed.

## Technical Tasks

- Review current `Event` usage and identify fields that will later become `OperatingUnit`: documented in [../phase-0-baseline.md](../phase-0-baseline.md).
- Mark places where code assumes one-off event behavior: documented in [../phase-0-baseline.md](../phase-0-baseline.md).
- Document local SQLite to cloud Postgres sync direction: documented in [../decisions/0002-local-sqlite-cloud-postgres.md](../decisions/0002-local-sqlite-cloud-postgres.md).
- Define the minimum ledger concepts needed before Phase 4: documented in [../decisions/0003-mvp-wallet-and-ledger-path.md](../decisions/0003-mvp-wallet-and-ledger-path.md).
- Keep README and plan documents aligned.

## Verification

- `npm run verify:phase0` passes.
- Hub health endpoint works.
- BOH and guest apps load locally.
- Local demo can still create, confirm, and settle an order.

## Exit Criteria

- CTO/product agrees on unified event/venue model, or explicitly requests separate models.
- MVP wallet path is provisionally chosen.
- Paga questions are ready for the vendor or CTO conversation.
- The immediate pilot target is clear.
- Current demo remains stable.
