# Slice 9: fit to play — working brief

Four people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` (sections 3, 4, 11 and 13 above all), `docs/SLICE1.md` for the facts and
conventions, and `docs/SLICE8.md` and `docs/API.md` for how the game went online.

Slices 1 to 8 built the whole game: the city, its traffic, every lever, a score from 0 to 1,000 in which every year
counts, a server that works out every month itself, and a leaderboard. It all works, and **no person has yet played
it.** Everything so far was checked by scripts and by looking at screenshots.

**Slice 9 makes it fit for a stranger.** The PRD's test for this slice: *five new players finish a first day without
help.* A first day is 12 game months. The person who conceived the game once looked at it and asked: "can i not lay
roads or metro lines? how do i play?" That question must never need asking again.

The player has looked at the map and the moving city and said they are right, after rejecting two earlier versions
on sight. **Keep the look as it is:** pale land, white streets, cream main roads, quiet white cards with a soft
shadow, plain numbers well set. Nothing in this slice may be loud, cute or busy.

## What done looks like

- A person who has never seen the game learns it by doing, in their first month: reads the score, mends a road,
  adds a bus route, ends the month, and sees what their acts did (PRD UI-11). They can skip it. It never comes back
  unasked.
- The first year does not bury them: they meet the levers a few at a time, and at every moment the game can answer
  "what could I do now?" with something they can afford.
- What a new player does in the first year visibly moves their score within that year, and the game says so.
- Every page and every act works on a phone held in one hand, at 360 px wide, with a thumb.
- A finished game gives a picture and a link to share (MP-14): the map, the score, and one line such as "I cut
  Bengaluru's commute by 14 minutes." The link opens that city.
- Sound: quiet, few, off by a switch, never the first thing a player hears without having touched the page.
- It can be used with a keyboard, read by a screen reader where a list or a number is what matters, and told apart
  without colour.

## The agreed interfaces

Fixed. Stubs of each exist now, so that everything compiles from the first minute.

- `src/ui/signals.ts`: `signal(name, detail)` and `onSignal(hear)`. The screen says when something happened; the
  sound and the introduction listen. The names are in the file. Whoever owns the code where a thing happens calls
  `signal` there.
- `src/sound/index.ts`: `installSound()`, called once by `main.ts`.
- `src/share/index.ts`: `shareCard(into, input)`, called by the ending.
- `src/rules/types.ts`, `src/sim/types.ts`, `src/net/types.ts`, as before. You may add optional fields.
- Each person who needs styles writes them in a file of their own, imported by their own module
  (`src/ui/first.css`, `src/share/share.css`). Only P edits `src/ui/style.css`.

## Who owns what

| Person | Owns |
|---|---|
| **F: the first day** | `src/main.ts`, `src/ui/intro.ts`, `src/ui/bar.ts`, `src/ui/panel.ts`, `src/ui/season.ts`, `src/ui/board.ts`, `src/ui/theirs.ts`, `src/ui/score.ts`, `src/ui/report.ts`, `src/ui/review.ts`, `src/ui/events.ts`, `src/ui/first.css` and other new files `src/ui/first*.ts`, `src/net/*`, `src/sim/worker.ts`, `src/game/*`, `index.html`, `tools/look-first.mjs`, `tools/look-online.mjs`, `tools/look-turns.mjs`, `tools/look-score.mjs` |
| **P: phone and hands** | `src/ui/style.css`, `src/ui/build.ts`, `src/ui/lines.ts`, `src/ui/levers.ts`, `src/ui/books.ts`, `src/ui/controls.ts`, `src/ui/figures.ts`, `src/ui/chart.ts`, `src/ui/format.ts`, `src/map/*`, `vite.config.ts`, `tools/look-phone.mjs`, `tools/look-build.mjs`, `tools/look-roads.mjs`, `tools/look-upkeep.mjs`, `tools/look-map.mjs`, `tools/look-perf.mjs` |
| **M: share and sound** | `src/share/*`, `src/sound/*`, `src/ui/ending.ts`, `src/ui/citymap.ts`, `public/sound/*`, `server/*`, `deploy/*`, `docs/SERVER.md`, `docs/DEPLOY.md`, `tools/look-share.mjs` |
| **B: model and rules** | `src/sim/*` except `types.ts` and `worker.ts`, `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `tools/playthrough.ts`, `docs/MODEL.md`, `docs/RULES.md`, every test of the model and the rules |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `docs/API.md`, `src/ui/signals.ts`, `src/data/*`, `public/data/*`,
`public/tiles/`. The root `package.json` changes only through `npm i`, and nobody should need to.

## Ports

The game's dev server is on 5190 and must not be stopped. The game's server is on 5210 (`npm run dev` in `server/`)
and only M restarts it. Port 5200 belongs to another project: leave it alone. Stop nothing you did not start. For
built copies and scratch servers: F uses 5220 to 5229, P 5230 to 5239, M 5240 to 5249, B 5250 to 5259. All browser
scripts run against a built copy, never the dev server, which reloads whenever anyone saves a file.

## The jobs

### F: the first day
1. **The introduction, taught by doing** (UI-11). Today it is five cards of words. Make it the first month, done by
   the player's own hand: read the score; mend a bad road near the centre; add a bus route; end the month; read
   what those did. Each step points at the thing to press, waits for the player to do it, and says in one line what
   it did. The player may skip at any step, and may wander off and come back. Never more than two short sentences
   on the screen at once. It is asked for again from the You page.
2. **"What could I do now?"** At any moment, one button answers with three things the player can afford now that
   would raise the score most, each with its cost and what it is expected to do, and one press to begin it. The
   rules have `suggest`; B is making it fast and good. A new player who is lost presses this.
3. **Levers a few at a time.** In a first game the Build and Money pages begin with the few levers that matter
   first, and the rest arrive over the first year, each announced in one line when it arrives. B decides the order
   (`src/rules/unlock.ts`); you show it. A returning player, or one who asks, has everything at once.
4. **What your acts did.** After a month in which something the player built opened, or a lever they moved took
   hold, the report leads with it: "Your bus route from Hebbal to Majestic carried 41,000 people a day. Commute
   down 0.3 minutes." The causes are already worked out; lead with the player's own.
5. **The start screen** (UI-10) for someone coming back: the season, days left, their game and where they left it,
   what opened or went wrong while they were away, and the top of the board.
6. **The first day's end.** When the allowance runs out, or in a season without one after 12 months at one
   sitting, the game says what the player achieved today and when to come back, and lets them go on in practice.
7. **Signals.** Call `signal` wherever the things in `src/ui/signals.ts` happen in your files, and call
   `installSound()` in `main.ts`, both within your first few minutes: M is waiting on them.
8. **A stranger's first day, by script:** `tools/look-first.mjs` plays a new player through the introduction and
   on to month 12, pressing only what the screen suggests, at laptop and phone size, against the server on 5210.
   It must end the day with a score higher than doing nothing gives. Screenshots of every step. Open each with the
   Read tool and look, as a person who has never seen the game.
9. **Words.** Read every word a new player meets in the first day. Plain English, short sentences, no jargon
   ("assignment", "mode share", "headway" are jargon), sentence case, no exclamation marks.

### P: phone and hands
1. **Every page at 360 and 390 wide,** with a thumb: Score, Build, Report, Money, Board, the review, the ending.
   Targets at least 44 px. Nothing cut off, nothing under the dock, no sideways scrolling, no text under 13 px.
   The keyboard coming up must not hide the field being typed in.
2. **Building by touch.** Laying a metro line, a bus route, a bus lane, a road: tap and snap, as decided with the
   player. Try each on the phone with a finger-sized touch (playwright touch events, `hasTouch: true`). A finger
   hides what it touches: show what will be chosen beside the finger, not under it. Undo the last tap. Pinch and
   drag must never place a stop by accident.
3. **The sheet and the map together.** On a phone the page covers the map. While building, the sheet must get out
   of the way and come back; while reading a map view, the legend must be in sight.
4. **Speed on a phone.** Measure with the processor slowed four times (CDP `Emulation.setCPUThrottlingRate`):
   first sight, a month, moving the map, laying a line. Say what a mid-range Android phone would feel. Fix what is
   cheap to fix.
5. **Hands other than a mouse.** Every act reachable by keyboard, with focus that can be seen; the map's acts have
   a list that does the same without the map (choose a road from the worst roads list, a stop from a list of
   places). Headings, lists and live regions where a screen reader needs them: the score changing, a refusal, a
   month ending.
6. **Without colour.** Every map view and every line told apart by more than colour: check each view through the
   three common kinds of colour blindness (simulate in the screenshot), and fix where two things that matter
   become one. Respect `prefers-reduced-motion`: the moving city and the day's playback stand still.
7. **Signals.** Call `signal('placed')`, `signal('built')`, `signal('changed')` and `signal('refused')` where those
   happen in your files, within your first few minutes.
8. **`tools/look-phone.mjs`:** every page and every kind of building at 360 × 640, 390 × 844 and 412 × 915, with
   touch. Open each screenshot and look.

### M: share and sound
1. **The share picture** (MP-14): 1200 × 630 and 1080 × 1350, drawn in the browser on a canvas. The city's
   outline, its metro lines with what the player built standing out, the score large, the rank if there is one,
   the player's name if they have one, "Peak Ooru ಪೀಕ್ ಊರು", and one line about what they did. In the game's
   look: it should be recognisable as this game at the size of a thumbnail in a chat.
2. **The one line,** chosen from what the game's figures say changed most over the ten years, against where the
   city began: "I cut Bengaluru's commute by 14 minutes." "I put 9 lakh more people on the metro." "Road deaths
   fell by a third on my watch." Never a boast the figures do not bear out. For a poor game, an honest and
   good-humoured line: "Bengaluru survived me. Just." Write the chooser with tests.
3. **Sharing:** the phone's own share sheet where there is one (`navigator.share` with the picture as a file),
   otherwise save the picture and copy the link. The link is `/?city=<game id>` and opens that city to look
   round, which the screen already can (F owns the reading of the link in `main.ts`; tell F at once what you need).
4. **The link's preview.** A link pasted into WhatsApp shows a picture only if the page it fetches names one, and
   WhatsApp runs no script. The server answers `GET /share/:id` with a small page carrying the title, the line
   and a picture address, which then sends a person on to `/?city=<id>`; and `GET /share/:id.png` with the
   picture. The browser uploads the picture it drew when the game ends (`PUT /api/games/:id/picture`, the
   player's own finished game only, PNG only, checked by its header bytes and its size, at most 400 KB, once).
   Pictures are kept as files beside the store. Add the nginx lines to `deploy/`. **Deploy nothing; connect to no
   machine but this one.**
5. **Sound,** made in the browser with Web Audio: no files to download unless you find you need one. Few and
   quiet: a press, a thing placed, a thing built, a month ending (rising a little if the score rose, falling if
   it fell), something opening, a refusal, the review, the ending. A soft bed of city sound during "Play the day"
   if it can be done well; leave it out if it cannot. Nothing plays until the player has touched the page. A
   switch on the You page and in the bar (ask F for where), remembered; off when the device asks for reduced
   motion or the page is hidden. Sounds must sit well together: choose one scale and keep to it.
6. **Nobody here can hear.** You cannot listen to what you make, and neither can the person coordinating. So:
   render each sound with `OfflineAudioContext` in a test page, measure its length, peak and loudness, check no
   clipping and no click at the start or end (the first and last samples near zero), draw each waveform and
   spectrum to a picture and look at it, and write `tools/listen.html`, a page where the player can press each
   sound and hear it. Say plainly in your report that no one has heard them.
7. **The ending** (UI-18): the share card takes its place in the ending, which already has the score, the rank and
   the ten years in a chart.

### B: model and rules
1. **`suggest`, fast and good.** Forecasts take 1.3 to 1.8 s each. "What could I do now?" needs three good
   suggestions, affordable now, in under a second in all, at any month of any game. It may use cheaper estimates
   to choose candidates and the model to confirm few. What it suggests must, when done, raise the score in a
   scripted game more often than not: measure it (a scripted player who does only what is suggested, each month,
   must end well above doing nothing, and you report its score).
2. **The first year must answer back.** A new player mends a road and adds a bus route in month one. Within the
   first year the score must move for it, visibly (a few points at least), and the report must be able to say
   why. Measure what each of the cheap first acts does to the score after 3, 6 and 12 months: mending the ten
   worst roads, one bus route on a busy corridor, a bus lane, footpaths in one zone, a fare cut. Where a sensible
   act does nothing or harm within the year, find out why and put it right in the model or the rules, not by
   special pleading for the first year.
3. **The order levers arrive** in a first game: `src/rules/unlock.ts`, `unlocked(month): kinds`, from cheap and
   quick (mending, buses, fares) to dear and slow (metro, new roads, density), all within the first year. It
   limits what the screen offers, never what the rules allow: the server does not know of it.
4. **Plans that ought to do well and do not.** A player who only makes streets safe scores below one who does
   nothing (386 against 423). One who only builds metro scores 483. Find why, and whether the model or the marks
   are at fault. A sensible single-minded player should beat doing nothing clearly; an all-round one should beat
   them.
5. **Keep the figures still where you can.** The season's marks and opening figures depend on the model. If your
   changes move them, make them again with `playthrough.ts marks` and `opening`, raise the rules version, and say
   how far each moved. M must then restart the server: tell the coordinator.
6. Keep `simulate` and `rules` working at every moment. F, P and M call them constantly.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures, measured.
- Each screenshot you opened and what you saw.
- The checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build` into a scratch folder, and for M the server's
  tests.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own.
