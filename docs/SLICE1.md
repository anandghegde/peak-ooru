# Slice 1: the city, drawn — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## The game

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on
governance against other players. Read `docs/PRD.md` in full before you start. Nothing of the game is built yet.

Slice 1 is the city alone: all of Bengaluru drawn at full speed on a laptop and a phone, with its zones, main roads
and existing transit, and nothing to play. It exists so that the player can look at the map and say whether it is
right before anything is built on top. **Two earlier versions of this game were rejected by the player on sight**
("what is this crap. there is no bangalore map", "its still so awful"). The look that was then accepted is the one
the base map already has: a real map in calm, pale colours, thin roads, quiet white panels. Keep to it.

## What exists

| File | What it is |
|---|---|
| `public/tiles/bengaluru.pmtiles` | The base map: a 39 MB vector tile archive cut from the Protomaps build of OpenStreetMap, zoom 0 to 15, bounds 77.35–77.85 E, 12.75–13.20 N. Read by range requests, so only what is looked at is downloaded. |
| `src/map/style.ts` | The base map's style, in the accepted colours. |
| `src/main.ts` | Creates the map (MapLibre GL 6). Exposes `window.peakooru.map` in development. |
| `src/ui/style.css`, `index.html` | The page. |
| `src/data/types.ts` | **The agreed shape of the game's data. Fixed: build to it. You may add optional fields.** |
| `tools/look-map.mjs` | Opens the map in a real Chrome at laptop and phone size and saves screenshots to `tools/shots/`. |
| `../namdaari/` | The earlier game. Read it freely; copy from it what helps; do not edit it and do not import from it. Useful: `tools/fetch-district.sh` and `tools/build-district.ts` (OpenStreetMap to roads and transit), `src/district/build.ts` and `shapes.ts`, `src/render/renderer.ts` (how stations and lines were drawn), `src/render/palette.ts`. |

## Facts

- Dev server: `http://localhost:5190` (`npm run dev`). It is running. Do not start a second. It reloads the page when
  any file is saved, which can fail a browser script partway; run the script again.
- Browser scripts use playwright-core with `chromium.launch({ channel: 'chrome', headless: true })`.
- Run TypeScript tools with `npx vite-node <file>`.
- The `timeout` shell command does not exist here. The shell is zsh: quote anything with `*` in it.
- Homebrew and Go are installed. `pmtiles` is installed. Install what else you need with `brew` or `npm`, and say what.
- The Overpass API is unreliable (504s). Fetch layer by layer, with retries across servers, as
  `../namdaari/tools/fetch-district.sh` does. For the whole city a regional extract cut with `osmium` may serve better.
- Keep downloaded raw data in `tools/data/` (not published). Built data goes in `public/data/`.
- MapLibre cannot shape Kannada text (it draws the letters unjoined). Kannada on the map has to be drawn by the
  browser, as HTML over the map.

## Conventions

- Match the style of the code that is there: no semicolons, single quotes, 2-space indent, 120 columns.
- Comments say why, in plain words, and are sparse. Doc comments on exported things.
- Text the player sees is plain English: short sentences, no jargon, sentence case, no exclamation marks.
- Minimum code that does the job. No speculative options or abstractions.
- Tests (Vitest, in `tests/`) are named for the behaviour they check.

## Checks (all must pass before you report)

```
cd /Users/ahegde/sandboxes/peak-ooru
npx tsc --noEmit
npx vitest run
npx vite build
```

Another person's half-finished work may break a check in a file you do not own. Wait a minute and run again.
If it is still broken after a few tries, say so in your report.

## Who owns what

| Person | Owns |
|---|---|
| **A: roads and transit** | `tools/fetch-city.sh`, `tools/build-network.ts`, `tools/build-transit.ts`, `src/data/network.ts`, `src/data/transit.ts`, `public/data/network.json`, `public/data/transit.json`, `tests/network.test.ts`, `tests/transit.test.ts` |
| **B: zones** | `tools/build-zones.ts`, `tools/fetch-zones.sh`, `src/data/zones.ts`, `public/data/zones.json`, `public/data/zones.geojson`, `tests/zones.test.ts`, `docs/DATA.md` |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, `tests/screen.test.ts`, `tests/style.test.ts` |

Nobody edits `docs/PRD.md`, `docs/SLICE1.md`, `src/data/types.ts` (except to add optional fields, saying so in the
report), `package.json` by hand (use `npm i`), or `public/tiles/`.

## The jobs

### A: roads and transit
1. **The main-road network** of the whole city, to the shape in `src/data/types.ts`: motorway, trunk, primary, secondary
   and tertiary roads and their links, split at junctions (shared OpenStreetMap nodes, so that a flyover does not join
   the road beneath), with lanes, one-way, speed, name and level. Defaults by class where the data is silent. Lanes from
   `width` where `lanes` is missing. Mark gateways where a road leaves the map. Mark mapped signals.
2. **Make it sound.** One connected network: drop fragments that cannot reach the centre and be reached from it.
   Merge the chains of tiny pieces that the map data cuts roads into, so that a stretch runs from junction to junction.
   Report the counts. PRD CITY-3 expects about 5,000 stretches; say what you got and why.
3. **Transit as it stands:** Namma Metro lines in service with their stations in order (Purple, Green, Yellow), lines
   under construction (Pink, Blue and any other mapped) as `building`, and the suburban railway with its stations as
   `rail`. Line colours are the lines' own. Station names in English and Kannada from the map data. An interchange where
   two lines share a station is one interchange. Take everything from the data, not from memory, and check the order
   of stations against a published list.
4. **Loading.** `src/data/network.ts` and `src/data/transit.ts` load the built files and give typed access.
   Files must be small: aim for under 1.5 MB compressed for the network. Say what you got.
5. C will draw what you build. Get a first, rough `network.json` and `transit.json` into `public/data/` early, even
   if imperfect, and improve them after.

### B: zones
1. **Find the boundaries.** The city's wards were redrawn when the Greater Bengaluru Authority replaced the old
   corporation. Find what open data exists: OpenStreetMap administrative boundaries, the DataMeet collections of
   municipal maps, government open data. For each source note the date, the number of wards, the area covered and the
   licence. Write this up in `docs/DATA.md`. Choose one and say why. If the new wards are not openly available, use the
   best older set and say plainly that it is out of date.
2. **Build the zones,** to the shape in `src/data/types.ts`, covering the game's area. Outside the wards (the villages
   and towns at the edge of the map) make coarser zones so that the whole map is covered, or leave them out and say so.
   Expect 200 to 400 zones.
3. **People and jobs.** Population from the best open figures, scaled to a 2026 estimate with the method stated.
   Jobs have no open source by ward: estimate them from the map (commercial, office, industrial and retail land, tech
   parks, markets) and known totals, and say how. Income level from what proxies exist. All of this is approximate and
   `docs/DATA.md` must say so, with sources and licences.
4. **Two files:** `public/data/zones.geojson` with simplified outlines for drawing (under 600 KB compressed), and
   `public/data/zones.json` with the figures. `src/data/zones.ts` loads them.
5. **Joining the roads.** Each zone's `node` is a junction of A's network. Until A's `network.json` exists, leave it
   as −1; when it does, attach each zone to a junction inside it on a road of secondary class or above where there is
   one, and rerun.
6. C will draw what you build. Get a first, rough pair of files into `public/data/` early.

### C: screen
1. **The city at a glance.** Zoomed out, the base map is a tangle: every road the same weight and village names
   everywhere. The player has agreed how it should be: PRD section 13.3, requirements MAP-1 to MAP-5 and MAP-9.
   Zoomed in, keep the detail as it is.
2. **Transit on the map,** from A's `transit.json`: lines in their own colours, lines being built as dashed, stations
   as rings, interchanges as one ring, names that do not collide. Suburban rail quieter than metro.
3. **Zones on the map,** from B's files: outlines that are quiet, and shading by a chosen figure. For this slice two
   views, people per square kilometre and jobs per square kilometre, with a small control to choose and a key.
   Tapping a zone shows its name and figures.
4. **The network on the map,** from A's `network.json`, as a layer that can be shown for checking (a key or a
   control): links coloured by class, gateways and signals marked. This is the layer traffic will later colour.
5. **Kannada.** Place names the player most needs (the city's well-known areas, and every station) in English and
   Kannada, drawn by the browser over the map. They must move with the map without lag or jitter.
6. **The map's edges.** PRD MAP-6, MAP-7 and MAP-8: the view is limited to the data, the edge fades out, and the
   game opens framed on the city.
7. **Phones.** Everything works by touch at 390 px wide: pinch, drag, tap a zone, change the view. Targets at least
   44 px. Nothing depends on hover. Panels become sheets at the bottom. Safe areas respected.
8. **Performance, measured.** Write `tools/look-perf.mjs`: first sight of the map on a slowed connection (Chrome's
   "Fast 4G"), frames a second while panning and zooming by script, memory, and the size of the first download. Measure
   at laptop size, and at phone size with the processor slowed four times. The targets are PRD section 14
   (PERF-1, 2, 5, 6, 7). Report figures, and fix what misses.
9. **Look at everything.** Screenshots at laptop and phone size of: the whole city, the inner city, Silk Board,
   Majestic, Whitefield, Hebbal, Electronic City, each view, a zone tapped. Open each with the Read tool and look.
   Ask of each: would someone who lives there recognise it, and is anything ugly, crowded or broken?
10. Until A's and B's files exist, build against small stand-in files of your own in the agreed shape, and switch over
    when theirs appear in `public/data/`.

## Your report

- Lead with whether your part is fit to put in front of the player, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: counts, sizes, timings.
- Each screenshot you opened and what you saw (C); each source, its date and licence (A and B).
- The three checks.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
