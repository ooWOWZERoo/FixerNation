# FNE admin — Mission Control

Approved direction: prototype 1, Mission Control. Updated 2026-10-06. This replaces the earlier restrained ledger-stamp direction. Preserve the existing ledger stamp inside invoice and quote detail views; it is not the main visual identity.

## Shared architecture
- `admin-common.css`: the shared visual system, including light/dark colors, responsive breakpoints, controls and table styles.
- `admin-nav.js`: sidebar data and a single local SVG icon family. Workflow groups remain unchanged. Active child routes map Calendar to Morning Boost and Concierge to Quotes.
- `admin-shell.js`: shared top bar enhancement, local admin-page search, accessible mobile drawer, page introductions, responsive table wrappers, and the dashboard workspace cards.
- `assets/admin/mission-landscape.svg`: lightweight, local vector illustration. No external imagery or chart dependency.
- `admin-print.css`: invoice-only presentation, independent of the app shell.

## Direction
Dark teal sidebar, bright airy workspace, serif page titles, sunrise illustration, crisp white cards. Teal/coral/gold have distinct jobs. Use white text on dark teal and deep coral; use dark ink on gold. Dark mode retains all information and controls.

Dashboard gets the large mission hero. Working pages get a compact, contextual introduction. Metric styles have featured, standard and compact tiers. Existing page-specific layouts remain where needed for editors, calendars, maps and dense forms. Do not invent new colors, button systems, or page-local versions of shared controls.

The top bar page finder searches navigation destinations only, not records or people. Do not relabel it as global data search. No placeholder notification bell, invented live status or synthetic growth metrics. All production figures still come from the original APIs.

## Accessibility and behavior
Mobile navigation is a labeled drawer below 901px, with Escape close, focus trapping, focus return and a backdrop. Desktop sidebar remembers collapsed groups and scroll position. Active routes use aria-current. Theme controls are native buttons. Respect reduced-motion preferences. Tables scroll inside their own region on narrow screens. Never replace existing interactive DOM nodes or change business handlers when adjusting presentation.

## Scope and verification
26 admin HTML pages: 23 workspaces plus login, invitation acceptance and invoice printing. Public pages and school/district self-service portals use their existing separate presentation. This change does not alter API routes, authentication, payment logic, database tables, cron jobs or email sending. See MISSION_CONTROL_HANDOFF.md for validation and release instructions.
