---
name: AE Licence
description: The official programme of one analytics engineer's Olympiad, lettered after the Stockholm 1912 poster.
colors:
  poster-orange: "#d4691f"
  poster-orange-hover: "#df7d36"
  poster-cream: "#f6eedf"
  rail-ink: "#1d1a17"
  rail-ink-2: "#22180f"
  tick-ink: "#1e1b18"
  tick-ground: "#f1ebe1"
  primary: "#2f4e9c"
  primary-hover: "#253f80"
  primary-ink: "#fbf6ee"
  primary-soft: "#e4e9f5"
  ground: "#ede7de"
  surface: "#fffcf7"
  surface-2: "#f7f2ea"
  surface-3: "#ebe3d7"
  line: "#ddd4c7"
  line-strong: "#bcb1a2"
  ink: "#1e1b18"
  ink-2: "#4a433c"
  ink-3: "#6b6258"
  ok: "#4f6b1f"
  ok-soft: "#e8eed8"
  bad: "#b3323c"
  bad-soft: "#f8e3e1"
  warn: "#8f5c08"
  warn-soft: "#fbeed0"
  code-bg: "#faf6f0"
  selection: "#f5d2b1"
  d-sql: "#2f4e9c"
  d-modeling: "#6f8fcc"
  d-dbt: "#c4363f"
  d-quality: "#5c6d26"
  d-semantic: "#e8b623"
  d-warehouse: "#8c5d31"
  d-workflow: "#2b2723"
  d-orchestration: "#e07f86"
  d-governance: "#8f877c"
  d-business: "#b84e17"
typography:
  display:
    fontFamily: "Federo, Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "76px"
    fontWeight: 400
    lineHeight: 0.95
    letterSpacing: "0.01em"
  display-sub:
    fontFamily: "Federo, Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "36px"
    fontWeight: 400
    lineHeight: 1.25
    letterSpacing: "0.01em"
  headline:
    fontFamily: "Federo, Archivo Variable, ui-sans-serif, sans-serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1.05
    letterSpacing: "0.01em"
  title:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 680
    lineHeight: 1.3
  event-title:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 650
    lineHeight: 1.15
    fontVariation: "'wdth' 78"
  body:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.65
  body-sm:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Archivo Variable, Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "12.5px"
    fontWeight: 500
    lineHeight: 1.4
  code:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "13.5px"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  sm: "2px"
  md: "3px"
spacing:
  band-gap: "3px"
  frame: "16px"
  page-x: "32px"
  page-y: "40px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
    typography: "{typography.label}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-secondary-hover:
    backgroundColor: "{colors.surface-2}"
  button-ghost:
    textColor: "{colors.ink-2}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-ghost-hover:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.ink}"
  button-danger:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.bad}"
    rounded: "{rounded.md}"
    padding: "0 14px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.bad-soft}"
  button-poster:
    backgroundColor: "{colors.poster-cream}"
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.md}"
    padding: "0 20px"
    height: "44px"
  button-poster-hover:
    backgroundColor: "{colors.surface}"
  nav-item:
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "36px"
  nav-item-hover:
    backgroundColor: "{colors.poster-orange-hover}"
  nav-item-active:
    backgroundColor: "{colors.poster-cream}"
    textColor: "{colors.rail-ink}"
  input-field:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
  status-pill:
    rounded: "{rounded.sm}"
    padding: "2px 6px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    padding: "12px 20px"
  programme-band:
    backgroundColor: "{colors.d-sql}"
    textColor: "{colors.primary-ink}"
    height: "28px"
    padding: "0 8px"
  ticked-frame:
    backgroundColor: "{colors.tick-ground}"
    padding: "16px"
---

# Design System: AE Licence

## Overview

**Creative North Star: "The 1912 Official Programme"**

The app is printed matter for one analytics engineer's Olympiad, after Olle Hjortzberg's Stockholm 1912 poster (pinned by the user). A saturated poster orange carries the shell; cream Jugendstil lettering announces titles; the flag colours of the competing nations become ten discipline colours, each paired with its own pictogram; and the poster's border, a cream band of black ticks between two ink rules, frames the moments that matter: the day's programme and the licence plate you leave with.

Below the poster, the work happens on a warm stone ground with warm-white sheets: hairline-ruled tables, flat panels, small 3px corners, no decorative shadow. It is a dense, keyboard-first operating surface. The theory pages are long-form reading inside the same world. Light is the daytime desk and dark is a warm night ground; both are first-class and every token has a dark counterpart.

The world refuses the grey SaaS learning dashboard (card grids, progress rings, purple gradients) and the dark-IDE neon costume.

**Key Characteristics:**
- Poster orange shell rail and poster field, ink labels, cream active tile.
- Cream Federo lettering, uppercase, for page titles, the home and exam hero, and level plates only.
- Ten flag colours, each bound to one discipline and one pictogram, used as full-strength bands and squares.
- The ticked frame as the single ornamental device, reused in exactly two places.
- Flat stone and warm-white surfaces separated by hairline rules.
- Archivo for everything you read or operate; JetBrains Mono for code and data.

## Colors

A printed-poster palette: one hot orange field, a cream and ink pair, a navy action colour, and ten flag colours that only ever mean "discipline".

### Primary
- **1912 Poster Orange** (poster-orange): the shell rail, the mobile top bar, the home and exam poster fields, and the licence plate face. Dark mode deepens it slightly (#c9621c) rather than abandoning it.
- **Poster Cream** (poster-cream): lettering on the orange field, the active nav tile, the poster button. It is also the light end of the ticked frame.

### Secondary
- **Programme Navy** (primary): the one action colour on stone and white: primary buttons, links in prose, focus rings, the text caret, the editor's cursor and active line, the current exam task ring. Pairs with **Navy Wash** (primary-soft) for informational pills and runnable-code buttons on hover.

### Tertiary
- **The ten flag colours** (d-sql navy, d-modeling cornflower, d-dbt red, d-quality olive, d-semantic yellow, d-warehouse bronze, d-workflow black, d-orchestration rose, d-governance warm grey, d-business burnt orange), each with a paired on-colour (`--on-d-*`) for text and pictograms placed on it. They fill programme bands, discipline squares, the exam section bar, and mastery meters.

### Neutral
- **Warm Stone** (ground): page background below the poster field.
- **Warm White** (surface), **Linen** (surface-2), **Oat** (surface-3): working sheets, hover fills, empty meter tracks and skeletons, inline code.
- **Hairline** (line) and **Strong Hairline** (line-strong): table rules, panel borders, secondary button and input strokes.
- **Ink** (ink), **Ink 2** (ink-2), **Ink 3** (ink-3): text in three steps; Ink 3 is the floor for small metadata.
- **Status**: ok olive, bad red, warn ochre, each with a soft fill, used as text-on-soft pills and result words, never as fills behind body text.
- **Code paper** (code-bg) and **Apricot selection** (selection).

### Named Rules
**The Poster Orange Rule.** Orange is the field, never a control. It belongs to the shell rail, the poster field, and the licence plate; buttons, links and data on stone never take it.

**The Flag Band Rule.** A flag colour means one discipline and nothing else. It always appears with that discipline's pictogram or name, at full strength, with its paired on-colour for anything placed on it. Never use a flag colour for status, emphasis, or decoration.

**The Cream On Orange Rule.** Cream on poster orange is about 3.1:1. It is for lettering at 24px and above and for filled cream tiles carrying ink text. Small text on the orange field is rail ink.

## Typography

**Display Font:** Federo (with Archivo Variable fallback)
**Body Font:** Archivo Variable, width axis loaded (with system sans fallback)
**Label/Mono Font:** JetBrains Mono Variable (with ui-monospace fallback)

**Character:** Federo is the poster's Jugendstil lettering: tall, calm, uppercase capitals that announce. Archivo does all the work, from nav labels to dense tables, and its width axis gives the programme its condensed event voice. JetBrains Mono is reserved for SQL, YAML, Jinja and keyboard keys.

### Hierarchy
- **Display** (Federo 400, 42px to 60px to 76px across breakpoints, line-height 0.95, uppercase, max 16ch, balanced): the poster lettering lockup on Home and the exam intro. The licence plate's level code uses the same face at 84px.
- **Display sub** (Federo 400, 24px to 36px, uppercase): the swash-flanked second line and the meta line of the lockup; the plate's level name at 28px.
- **Headline** (Federo 400, 34px, line-height 1.05, uppercase): page titles in the page header.
- **Title** (Archivo 680, 17px): section headings such as "Discipline standings" and panel titles.
- **Event title** (Archivo 650, 14px, width 78%, line-height 1.15, up to three lines): event names inside programme cells; 12.5px in the compact strip.
- **Body** (Archivo 400, 15px leads and 16px prose, line-height 1.65, max 75ch): page leads and theory prose; prose subheads at 18px and 16px weight 650.
- **Small and label** (Archivo, 13px body text, 12.5px labels at 500, 12px metadata in Ink 3, 11.5px band times at 600 with tabular numerals).
- **Code** (JetBrains Mono, 13.5px in the editor, line-height 1.6; 0.86em inline in prose).

### Named Rules
**The Lettering Only Rule.** Federo is for page titles, the poster hero, and level plates, always uppercase and never below 24px. It never sets UI labels, buttons, table text, or body copy.

**The Tabular Numbers Rule.** Times, counts, scores and percentages use tabular numerals so the programme and standings columns hold still.

## Layout

A fixed 232px orange rail on the left from the large breakpoint (1024px); below it, a 56px sticky orange top bar with a slide-in 260px rail over a 40% black scrim. Content pages sit in a centred column of 1180px, or 1500px for the wide Home, workspace and exam views, with 16px side padding on mobile and 32px from the small breakpoint, and 32px to 40px vertical padding.

Poster fields run full-bleed across the content area, above the page column. On Home the poster field holds the ticked programme frame, then the centred lettering lockup, then the cream Continue button with a rail-ink caption, all on 24px to 32px vertical steps. Below on stone, a two-column grid (fluid main, 380px aside) from the extra-large breakpoint.

The programme strip is a proportional time axis on extra-large screens (each event's width follows its duration, minimum 88px) and becomes a horizontally scrolling, snap-aligned row of fixed 128px cells (96px compact) below that. Programme cells and exam section segments are separated by a 3px gap, never by borders. Reading text holds at 75ch.

## Elevation & Depth

The world is flat print. Depth comes from field changes (orange poster, stone ground, warm-white sheet), hairline rules, and the ink rules of the ticked frame. Surfaces carry no shadow at rest or on hover.

### Shadow Vocabulary
- **Modal lift** (`box-shadow: 0 18px 50px -12px rgba(0,0,0,0.35)`): the confirm dialog only, the one surface that genuinely sits above the page.

### Named Rules
**The Flat Programme Rule.** Panels, cells, tables and buttons are flat. Separation is a field change or a 1px rule. A shadow appears only on a true overlay.

## Shapes

Small, printed corners: 3px for buttons, nav items, inputs, keys and the theme switch; 2px for status pills, discipline squares and switch thumbs. Programme cells, flag bands, discipline squares in tables, meters, panels and the licence plate are square-cornered, like cut paper. Bullets in prose are 6px squares, not discs. Meters are 8px flat bars on an Oat track with no rounded ends. The difficulty mark is three 4px by 10px upright bars.

The ticked frame is the one ornamental form: a 1.5px ink rule, an inset band of 2.5px ticks on a 6px pitch, and a second 1.5px ink rule around the framed content, on a tick-ground fill with 16px padding.

## Components

### Buttons
Compact, flat and decisive.
- **Shape:** gently squared corners (3px), 36px tall (32px small, 44px for the poster CTA), 14px horizontal padding, Archivo 500 at 14px, icon gap 8px.
- **Primary:** Programme Navy with primary-ink text; hover deepens to primary-hover. One primary per region.
- **Secondary:** warm-white with a strong hairline and ink text; hover to Linen. The default variant.
- **Ghost:** Ink 2 text on nothing; hover fills Oat and darkens to Ink.
- **Danger:** warm-white with a strong hairline and bad-red text; hover fills bad-soft.
- **Poster:** the cream button that lives only on the orange poster field, ink text, 44px, hover to warm-white.
- **Focus / Disabled:** 2px focus ring in the focus colour at 2px offset; disabled drops to 50% opacity with a not-allowed cursor. Colour transitions run 150ms.

### Chips
- **Discipline tag:** an 18px flag-colour square with the 12px pictogram in its on-colour, followed by the discipline name in Ink 2 at 12.5px, weight 500.
- **Status pill:** soft-fill with matching strong text (ok, bad, warn, info navy, muted Oat), 2px corners, 12px semibold.

### Cards / Containers
- **Corner Style:** square.
- **Background:** warm-white on stone.
- **Shadow Strategy:** none (see The Flat Programme Rule).
- **Border:** 1px hairline around the panel and between its header, body and footer rows.
- **Internal Padding:** 20px horizontal, 12px to 16px vertical per row.

### Inputs / Fields
- **Style:** warm-white fill, 1px strong hairline, 3px corners, 8px by 12px padding, 14px Ink text with Ink 3 placeholders, navy caret.
- **Focus:** the global 2px navy focus ring.
- **Code editor:** code-paper ground, borderless gutters in Ink 3, a 2px navy cursor, a 6% navy wash on the active line, and syntax in the poster palette (navy keywords at 600, olive strings, bronze numbers, red functions, orange Jinja at 600, italic warm-grey comments).

### Navigation
- **Rail:** the mark plus "AE Licence" in rail ink at 16px weight 720, then six 36px items with a 16px line icon and a 14px weight-500 label in rail ink. Hover takes the lighter orange; the active item becomes a cream tile with ink text. A cream "LIVE" tag marks a running exam. The foot holds warehouse status (an 8px discipline-colour square), the synthetic-data note, and a three-way light/system/dark switch on a 10% black track with a cream thumb.
- **Mobile:** the same rail ink on a 56px orange top bar; the menu opens the full rail as a drawer.

### Programme Strip (signature)
The workday as flag-coloured events: each cell is a full-colour band (28px, 24px compact) carrying the start time and the discipline pictogram, or a check when complete, over a warm-white body with the condensed event title and a 3px progress line that fills from the left in 520ms on an expo-out curve. The current event takes a 2px inset ink ring. On Home the strip sits inside the ticked frame on the poster field.

### Ticked Frame (signature)
The poster's border, used exactly twice: around the programme strip on Home and around the licence plate on the exam result. The plate is a poster-orange face with the level code and name in cream Federo, an ink strip stating provisional status, and a warm-white body with the score triplet and the level ladder.

### Exam Section Bar
The programme strip reused as exam sections: each discipline is a 6px flag band over its numbered task squares, 20px tall and 3px apart. Answered squares are Ink 2 with surface text, open squares are Oat, the current task gets a 2px navy ring, and a flagged task carries a 6px warn square in its corner.

### Pictograms
Ten filled pictograms on a 24-unit grid with orthogonal and 45-degree geometry and one visual weight, always drawn in the on-colour of their discipline square or band.

## Do's and Don'ts

### Do:
- **Do** keep poster orange for the rail, the poster field and the licence plate, with rail ink for any small text on it.
- **Do** set page titles, the poster hero and level plates in uppercase Federo at 24px or more, and everything else in Archivo.
- **Do** show a discipline as its flag colour plus its pictogram or name, using the paired on-colour on top.
- **Do** separate programme cells and section segments with the 3px gap, and panel rows with 1px hairlines.
- **Do** use tabular numerals for times, counts and scores.
- **Do** define every new colour token for both light and dark.

### Don't:
- **Don't** build the grey SaaS learning dashboard: card grids, progress rings, purple gradients.
- **Don't** dress code surfaces in a dark-IDE neon costume; the editor uses the poster syntax palette on code paper.
- **Don't** use a flag colour for status, emphasis or decoration, or mix two disciplines' colours in one mark.
- **Don't** put shadows on panels, cells, tables or buttons; only a true overlay is lifted.
- **Don't** add the ticked frame to new surfaces casually; it marks the day's programme and the licence result.
- **Don't** set small cream text on poster orange.
