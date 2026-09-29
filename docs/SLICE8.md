# Slice 8: online — working brief

Three people are working on this at once, in the same folder. **Only edit the files you own.** If you need a change
in a file you do not own, say so in your report; do not make it. Do not run `git commit`, `git add` or any other
git command that changes the repository.

## Where things stand

Peak Ooru is a browser game. The player runs Bengaluru from 2026 to 2036, a month a turn, and is scored on governance
against other players. Read `docs/PRD.md` in full (sections 4, 11, 12 and 15 above all), `docs/API.md`,
`docs/RULES.md` and `docs/MODEL.md`. Read `docs/SLICE1.md` for the facts and conventions. They still hold.

Slices 1 to 7 built the whole game for one player in one browser: the city, its traffic, every lever, and a
governance score from 0 to 1,000. The player has looked at the map and the moving city and said they are right.
**Keep the look as it is.**

**Slice 8 makes it a contest.** The player's words, from the day the game was conceived: "it should be a multiplayer
game", "there should be a leaderboard, they dont all have to play at the same time, goal is to get the max number of
score after 2036". And on where it runs: "i will be hosting on my linode".

Each player has their own copy of the city. Everyone in a season starts from the same city and meets the same
events. Players never change each other's city. The server keeps every game, works out every month itself, and
ranks the scores.

## What done looks like

- A person opens the game and plays at once, with no account. Their game is kept on the server. They may give
  themselves a name to appear on the board, and sign in to play on another device.
- **A changed browser cannot produce a false score.** The server works out every month of every game by its own
  copy of the rules and the model, from the actions the player sent, and refuses what the rules do not allow. What
  the browser shows is a preview (PRD MP-30 to MP-34).
- The daily allowance of 12 game months, carrying over to 36, is kept by the server's clock (TIME-7, MP-33).
  Practice games have none.
- Seasons of four weeks. One ranked game a season, with one restart. Practice games without limit (MP-1 to MP-5).
- A leaderboard: everyone, friends, and by home zone; games in progress ranked by their score now and marked with
  the year reached; ranks fixed when the season closes (MP-10 to MP-12).
- Any finished city can be opened and looked round, with what its player did and when (MP-13).
- It runs on one Linode behind nginx, started by systemd, with the game's files and tiles served by nginx, and can
  be put there by following one document. **Nobody deploys anything in this slice:** the machine is the player's,
  and putting the game on it is theirs to do or to ask for.
- It is measured: how long the server takes to end a month, and how many players one machine carries.
- A month is worked out in 175 ms or less in Chromium on this machine (it is 265 ms now), because the server pays
  that for every month of every game, and an ordinary laptop pays twice it.

## The agreed interfaces

- `docs/API.md` is the server's interface. **Fixed.** S builds the server to it and C the screen, at the same time.
  If it is wrong, say so in your report at once and keep to it meanwhile; do not change it alone.
- `src/rules/types.ts`, `src/sim/types.ts` and `src/data/types.ts`, as before. You may add optional fields.
- `src/rules/digest.ts` exports `gameDigest(game): string`, the fingerprint both sides compare. It does not exist
  yet: **B writes it first, within the first few minutes**, since both S and C wait on it.

## Who owns what

| Person | Owns |
|---|---|
| **S: the server** | `server/*` (its own `package.json`, source, tests and scripts), `deploy/*` (nginx, systemd, the document for putting it on the machine), `docs/SERVER.md`, `docs/DEPLOY.md` |
| **B: model and rules** | `src/sim/*` except `types.ts` and `worker.ts`, `src/rules/*` except `types.ts`, `src/seasons/*`, `tools/run-month.ts`, `tools/calibrate.ts`, `tools/measure-*.ts`, `tools/playthrough.ts`, `docs/MODEL.md`, `docs/RULES.md`, `docs/DATA.md`, every test of the model and the rules |
| **C: screen** | `src/main.ts`, `src/map/*`, `src/ui/*`, `src/game/*`, `src/net/*` (new: talking to the server), `src/sim/worker.ts`, `index.html`, `vite.config.ts`, `tools/look*.mjs`, tests `screen*`, `style`, `playback`, `turns`, `net*` |

Nobody edits `docs/PRD.md`, `docs/SLICE*.md`, `docs/API.md`, `src/data/*`, `public/data/*`, `public/tiles/`, or the
`tools/build-*` and `tools/fetch-*` scripts. The root `package.json` changes only through `npm i`.

## The jobs

### S: the server
1. **One Node service** in `server/`, in TypeScript, to `docs/API.md`. It imports the rules and the model from
   `src/rules/` and `src/sim/` as they are: one body of code for both sides (PRD SIM-1). Find the simplest way to
   build and run it that keeps that true (a bundle made with esbuild or vite from `server/src/main.ts`, say). Few
   dependencies, each one justified.
2. **The store.** SQLite in one file (`better-sqlite3`, or Node's own `node:sqlite` if it serves), behind a small
   interface so that Postgres could take its place. Players, devices and tokens, sign-in codes, friends, seasons,
   games, the actions of each game with the real time each month was ended, and the board. Tokens and codes are
   kept hashed. Write-ahead logging on. A way to back it up while it runs.
3. **Ending a month (the heart).** For `POST /api/games/:id/months`: load the game as kept, do the actions by the
   rules, work the month out by the model, end it, keep it. The server keeps each game's latest state, so that a
   month costs one model run and not a replay from the start. It must also be able to play any game again from its
   list of actions and get the same state, and a command does so for every game of a season and reports any that
   differ (`npm run verify`).
4. **The model is slow for a server:** 175 to 265 ms of processor for each month, and it must not hold up other
   requests. Run it in worker threads, a few at a time, with a queue, and refuse with `too-many` when the queue is
   long. Measure: months a second on this machine with 1, 2 and 4 workers; memory for each worker; and from those,
   how many players a Linode of 2, 4 and 8 processors carries if each plays 12 months a day, mostly in the evening.
5. **Reports.** The screen shows a report after each month with the causes of every change, each of which costs a
   model run. The server must not pay for those: it keeps the score and the state, and the screen works out its own
   report from its own copy. Say in `docs/SERVER.md` exactly what the server works out and what it leaves.
6. **The allowance**, by the server's clock, from `src/rules/allowance.ts`. Off for practice games.
7. **Seasons.** Kept in the store; made and closed by a command (`npm run season -- open|close|list`). When a
   season closes, ranks are fixed and games still in progress are ranked as they stand. The first season's set-up
   comes from `src/seasons/first.ts`.
8. **The board.** Ranked by score, then by the earlier finish. Kept up as months end, so that reading it is cheap.
   Scopes all, friends, zone.
9. **Players and signing in.** A new player for each new device, with a token. Names checked (length, letters, a
   list of words not allowed, no two alike). Email sign-in by a code in a link, sent through SMTP settings from the
   environment; if there are none, email sign-in says plainly that it is not set up. Google sign-in by checking
   Google's credential against a client id from the environment; likewise if there is none. Joining a device's
   player to an account keeps the games of both. Deleting a player deletes everything (MP-24).
10. **What is kept about people (MP-23):** the email address, the name, the games. No addresses of machines kept
    beyond what the limits need, and those for a day. No tracking. Say so in `docs/SERVER.md`.
11. **Never trust the request.** Sizes limited; every field checked; months and actions out of step refused;
    limits on how fast one player or one address may ask. Tests that try to cheat: an action the rules refuse, a
    month skipped, a score sent in, another player's game, a game after its season closed, a month beyond the
    allowance, 121 months.
12. **Putting it on the machine.** `deploy/`: an nginx site that serves the built game and the tiles as files
    (with range requests for the tiles, long caching for files named by their contents, compression) and passes
    `/api` to the service; a systemd unit; the environment it needs; how to build, copy, start, update, back up
    and restore. `docs/DEPLOY.md` as steps a person can follow on a Linode running Ubuntu or Debian with nginx
    there already and other sites on it. HTTPS by the certificates the machine has. **Do not connect to any machine.
    Do not deploy.**
13. **Run it here** for the others: `npm run dev` in `server/` on port 5210 (5200 is taken by another project;
    wherever this brief says 5200, read 5210), with a store in a scratch file, the
    first season open, and the allowance as the season sets it. Have it up within your first hour, even if most
    calls are stubs that answer in the right shape, since C builds against it.

### B: model and rules
1. **`src/rules/digest.ts` first:** `gameDigest(game): string`, eight hex digits over the score, the money, the
   month, the status and the kept averages, by exact arithmetic. With a test. Both S and C wait on it.
2. **A month in 175 ms.** It is 265 ms in Chromium since routes were shared among near-best paths in slice 7. Find
   the time back without giving up the smoothness that the score depends on (the noise figures of slice 7 must
   hold: run `tools/measure-noise.ts` before and after). Where the time goes: finding each zone's routes, at midday
   and both peaks. Ideas: reuse last period's search where the network is the same; cheaper searches at midday and
   night; a tighter bound on how far from the best a path may be; typed arrays reused across months (the server
   runs thousands of months in one process: nothing may grow).
3. **A model that lives long.** On the server the model runs for days in one process, for many players' cities in
   turn. Check that nothing is kept from one city that could leak into the next (caches keyed by identity, or by a
   fingerprint of what they were built from), that memory does not grow over 10,000 months of different games, and
   that two cities worked out in turn give what each gives alone. Test it.
4. **Scoring the ten years.** A scripted player who does nothing for seven years and then spends on what shows
   within three scores 647, more than one who builds metro throughout, because the score is the average of the
   last twelve months only. Make the score of a game the weighted sum of each year's score, later years counting
   more, with the weights set by the season (`Season.years`, ten weights in thousandths): for the first season
   about 3% for 2026 rising to about 30% for 2035. The score shown during the game is the score so far by the same
   rule, so that it does not jump at the end. Rerun the scripted players and the marks, and report the table. This
   is the coordinator's recommendation, not yet confirmed by the player: keep the old rule within reach as a
   season whose last weight is 1,000.
5. **The allowance on.** The first season has it off for building. Make a second set-up, `src/seasons/open.ts`,
   the same season with the allowance on, for the server to use when the game goes to other players.
6. **Replay at speed.** The server will play whole games again to check them. `rules.replay` takes a list of
   actions and the model: make sure it does no more than one model run a month (no causes, no reports), and
   measure a whole game.
7. Keep `simulate` and `rules` working at every moment. S and C call them constantly.

### C: screen
1. **Talking to the server:** `src/net/`, to `docs/API.md`. One small module the rest of the screen uses. Where the
   server is comes from the build (`VITE_API`, `/api` by default, with the dev server passing `/api` to port 5200).
2. **Playing at once.** On first opening, the game asks the server for a new player and a game in the current
   season, and the player is in the city within the time it takes now. No form, no question. If the server cannot
   be reached the game says so plainly and offers a practice game kept in the browser, as until now.
3. **Ending a month** sends the month's actions to the server and goes on at once with the browser's own working
   out: the player must not wait on the network to see their month. When the answer comes, the fingerprints are
   compared; if they differ, the game is played again from the server's list, quietly, and the player is told only
   if what they see changes. If the server refuses (the allowance, the rules), the month is undone and the reason
   shown.
4. **The allowance**, shown in the bar when on: months left today, and when more arrive.
5. **Ranked and practice.** The player's ranked game for the season, its one restart, and practice games, which
   are plainly marked and never confused with it.
6. **The board** (PRD UI-16): everyone, friends, my zone. Rank, name, score, the seven measures as small bars,
   how the game ended, the year reached. The player's own row always in sight. It must be pleasant at 5 rows and
   at 50,000. On a phone as well.
7. **Another player's city** (UI-17): their map with what they built, their score and measures, and the list of
   what they did and when. Read-only, and plainly someone else's.
8. **A name, signing in, friends, home zone, deleting.** Small and out of the way: a player who wants none of it
   never sees a form. Asking for a name comes when it matters: when they first open the board, or finish a game.
   A friend is added by a code or a link.
9. **The start screen** (UI-10): the season, its twist, the days left, the player's game if there is one, the top
   of the board.
10. **The ending** now shows the rank, in the box left for it, and offers the board.
11. **An older version.** When the server's rules are newer than the screen's, the screen reloads itself at a
    moment that loses nothing.
12. **Look at everything.** `tools/look-online.mjs`, against S's server on port 5200 and a built copy of the game:
    a first visit; a month ended and checked; a month refused for the allowance; the board with a few hundred
    made-up players (ask S for a command that fills a season with them); another player's city; naming; a second
    device signing in to the same account; the server going away in the middle of a game and coming back.
    Screenshots of each, at laptop and phone size. Open each with the Read tool and look.
13. Until S's server answers, build against a stand-in of your own that speaks `docs/API.md`.

## Your report

- Lead with whether your part does what "done" asks, and if not, what stands in the way.
- What you built, file by file, in a line or two each.
- Figures: months a second, memory, players a machine carries; the time a month takes; the scripted plans under
  the new scoring.
- Each screenshot you opened and what you saw (C).
- The checks: `npx tsc --noEmit`, `npx vitest run`, `npx vite build`, and the server's own tests.
- What you could not do, or did and are unsure of. A weakness reported is worth more than one hidden.
- Any change you need in a file you do not own, and anything in `docs/API.md` that proved wrong.
