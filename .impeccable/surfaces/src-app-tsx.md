---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: []
---

# Surface brief: AE Licence app shell (all routes)

Scope: the whole single-page app — Home (today's programme), Workday events, Theory modules, SQL gym, dbt workspace, Licence exam, Report. Visitor mode: Operate (Theory pages are Read inside the same world).

Audience & job: returning analytics engineer preparing for a role like the reference ad in PRODUCT.md; focused laptop sessions to learn, drill, or sit the ~75-minute exam, then export the report to Claude.

Constraints: real execution (DuckDB-WASM + mini dbt); standard web controls; keyboard first; light/dark both first-class; no invented claims; synthetic company labelled synthetic.

## Direction contract

THESIS: The app is the official programme of one analytics engineer's Olympiad: ten disciplines with their own flag colour and pictogram, one workday run as the event schedule, a licence plate as the result. It refuses the grey SaaS learning dashboard (cards, progress rings, purple gradient) and the dark-IDE neon costume.

OWN-WORLD: User-pinned reference: Olle Hjortzberg's Stockholm 1912 Olympic poster. Saturated poster orange (#d4691f) carries the shell rail and the home header; cream Jugendstil display lettering (Federo) for page titles, the hero and level plates only; flag colours (navy, cornflower, red, olive, yellow, bronze, black, rose, warm grey, burnt orange) as discipline bands, chips and data series; warm stone ground, warm-white work surfaces. Archivo for all UI and body text, JetBrains Mono for code and data. Flat fields, small 3px corners, hairline rules, no decorative shadows.

STORY: The visitor sees where they are in the day and in each discipline, picks up the next event, practises for real, and knows the licence exam is the finish line; afterwards they hand Claude a report and get a level and a plan.

FIRST VIEWPORT: Orange rail (ink labels, cream active tile): mark + "AE Licence", nav Today · Theory · SQL gym · dbt workspace · Licence exam · Report. Main, top: an orange poster field with the programme strip (08:30→17:30, ten colour-banded events with time, pictogram, title, done count) inside the poster's ticked black-and-cream frame; beneath it, centred cream lettering "THE ANALYTICS ENGINEER'S DAY" / "~ TIDEPOOL COFFEE CO. 2026 ~" / "1 JULY · 08:30 — 17:30", and the cream "Continue: <next event>" button. Below on stone: Discipline standings table and the Licence status ladder.

FORM: Olympic programme system (assigned position 5 of 7), re-skinned to the user-pinned Stockholm 1912 poster; seed:48e22837b33c8020. Signature move: the poster's ticked frame around the programme strip, reused around the exam result's licence plate; the colour-banded strip doubles as the exam's section bar.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- The user supplied the Stockholm 1912 poster mid-build; it overrides the original Munich-'72 palette and type (brief-pinned beats the roll).

- None blocking. Roll ran degraded (no network to the roll service): no challengers were dealt; the user chose among the assigned direction, the pick (transit map) and the canon via the structured question tool.
