# Linear setup — current HRN team

Project: https://linear.app/hurbadnexus/project/hurbadhardware-b3d65d5c5127

Workspace: HurbadNexus. Team: HRN (UUID 48b76031-9714-4305-8106-2f4861de06c7). Project: HurbadHardware (P-HRN-2).

Verified: 8 milestones, 8 parent issues, 203 task sub-issues. IDs are exactly HRN-1 through HRN-211, without gaps. Every task is in Backlog and linked to its correct parent and milestone.

| Phase                                                        | Parent  | Tasks |
| ------------------------------------------------------------ | ------- | ----: |
| Phase 0 — Foundation                                         | HRN-1   |    22 |
| Phase 1 — Catalog and Search                                 | HRN-24  |    27 |
| Phase 2 — Cart, pricing, coupons, currency, wishlist         | HRN-52  |    20 |
| Phase 3 — Checkout, Inventory Reservations, Orders, Payments | HRN-73  |    30 |
| Phase 4 — Notifications, Jobs and Account                    | HRN-104 |    29 |
| Phase 5 — Admin Dashboard                                    | HRN-134 |    27 |
| Phase 6 — Modern Platform Features                           | HRN-162 |    24 |
| Phase 7 — Hardening and Launch                               | HRN-187 |    24 |

The current verified source is `current-hrn-state.json`, containing all created issue IDs and URLs. Earlier `linear-state.json`, `hurbadnexus-state.json`, and `hrn-*-state.json` files are historical records from earlier team attempts; do not use them as the current setup. The `fresh-hrn-phase-*.json` files are checkpoints for the current team.

Canonical implementation plans are in `../docs/plans/`; `RECONCILIATION.md` overrides older conflicting instructions. Task definitions are also saved in `phase-0.json` through `phase-7.json`.

Creation order follows parent → that phase's tasks → next parent. Each phase after Phase 0 is blocked by the preceding phase parent; each task after the first is blocked by the preceding task. Full task code and exact requirements remain in the canonical plan.

Linear display preferences were not changed. For the requested top-to-bottom hierarchy, use List layout with Nested sub-issues enabled and Manual ordering; arrange Phase 0–7 and their numbered tasks ascending if necessary. Identifiers alone do not enforce the selected display order.
