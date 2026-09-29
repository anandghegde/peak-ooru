# Peak Ooru — the server

The server behind `docs/API.md`: one Node service in `server/`, with the game's rules and model compiled in from
`src/rules/` and `src/sim/` as they are, a SQLite store in one file, and a few worker threads that work out months.
`docs/DEPLOY.md` says how to put it on a machine.

## Running it here

```
cd server
npm run dev          # port 5210, store in server/.data/dev.db (a scratch store), the first season opened if none is
npm test             # the server's own tests (test/*.check.ts)
npm run check        # types
npm run fill -- 300  # 300 made-up named players with scores, into the scratch store (see below)
npm run season -- list | open <set-up> | close [id]
npm run verify [-- season]   # plays every kept game again and reports any that differ
npm run load -- ...  # scripted players over HTTP, for measuring (server/tools/load.ts)
```

`npm run dev` rebuilds and restarts itself when the server, the rules or the model change. The screen's dev server
(port 5190) passes `/api` to it.

## What the server works out, and what it leaves to the screen

For each month the server does exactly this, in a worker thread:

1. loads the game's kept state (below);
2. does the month's actions in order by `rules.act`, which checks each; the first it refuses refuses the month, and
   nothing is kept;
3. works out the month by `simulate(rules.state(game, city))`: **one model run a month**, no more;
4. ends it by `rules.endMonth`, and keeps the new state, the score, the seven points, the digest, the month's actions
   (the rules' own clean copy of each, not what was sent) and the time it was ended.

It **does not** work out the causes of changes (`explain`, which costs further model runs), the "why is this bad"
answers, suggestions, quotes or forecasts. The report `rules.endMonth` makes is thrown away: the screen works out its
own report, with causes, from its own copy of the game. A report decides nothing that follows: the rules read old
reports only for words in later reports.

What the screen sends that the server takes: the month it is ending, and the actions. What it takes from the screen's
digest: nothing. The score in the answer, and on the board, is the server's.

## What is kept

- **Players:** an id, a friend code, the name if given, the home zone if given, the email address if the player
  signed in (by email or Google: only the verified address is taken from Google's credential), when they were made.
- **Tokens and sign-in codes:** kept only as SHA-256 hashes. A code lasts 30 minutes and works once.
- **Friends:** pairs of player ids.
- **Seasons:** as opened by the command, with the season's set-up (`src/rules/types.ts` `Season`) and the rules
  version they are played by.
- **Games:** the season, ranked or practice, whether restarted, the month, status, score, points, digest, when started
  and ended, the rank fixed at the season's close; and the **state** (below).
- **Months:** for each month ended, the actions done in it, the time it was ended, and the digest after it. From these
  any game can be played again (`npm run verify`) and looked round (MP-13).
- **Allowance used:** the times a player ended a month of ranked play in a season, for the daily allowance.

**The kept state** is the whole `Game` object but its reports: the money, loans, works, what is built, the condition of
every road (`wear`), approval by zone, the figures of every month for the score, and the last month's traffic (`last`,
typed arrays of flows and speeds, which the rules read for the loan limit and the roads). It is serialised by V8's own
structured serialiser (which keeps typed arrays exactly) and compressed: about 140 KB after a month. A test
(`server/test/state.check.ts`) plays months with and without saving and loading between each, and checks that the two
games are equal in every value, typed arrays included; and that playing again from the list of actions gives the same.

**Limits** (in memory): 30 months a minute a player; 200 new players an hour an address (`NEW_PLAYERS_PER_HOUR`,
since mobile carriers put many phones behind one address); 600 requests a minute an address (`REQUESTS_PER_MINUTE`);
sign-in links 5 an hour an address and 3 an email address; 20 tries at codes an hour an address; 30 new games an hour
a player.

**Nothing else about people is kept** (PRD MP-23). No addresses of machines are written anywhere by the server: the
limits count addresses in memory only and forget each within the hour. No logs of requests are kept by the server;
its failures are logged without addresses or email addresses. nginx is set not to log requests for the game
(`deploy/nginx.conf`). No cookies, no tracking, no advertising. Deleting a player (`DELETE /api/me`) deletes the
player, their tokens, friends, games, states, months and allowance used, at once.

## Details that `docs/API.md` leaves open

- **Statuses:** `unauthorised` 401, `not-found` 404, `refused` 422 (400 for a body that cannot be read, 413 for one
  too large), `allowance` 403, `season-over` 403, `out-of-step` 409, `name-taken` 409, `name-not-allowed` 422,
  `too-many` 429, `older-version` 409. A failure of the server's own is 500 with code `server`.
- **`points`** are 0 to 100, to a tenth (the rules' `Measure.points` over ten), in the order access, commute,
  clean, safety, fairness, money, approval.
- **`allowance`** of a game without one (a practice game, or a season with it off): `{ on: false, left: <months left
  in the game>, more: null }`. With it on, `more` is the coming midnight in India, or null when 36 are held (no more
  arrive until some are used). The allowance is the player's for the season: the months of a ranked game restarted
  still count.
- **`done`** items (`GET /api/games/:id` and `/city`) carry, beside `month` and `action`, `at`: the time the month
  was ended, for "what the player did and when".
- **`friends`** is a list of `Player`.
- **The board's `rank`** is always the rank among everyone named in the season; the friends and zone boards are that
  board filtered. `zone` is the asking player's home zone; with none, the zone board is empty. While a season is open
  the board is made again at most every two seconds after a month ends, and at once after a name or zone changes. `open` is true for a finished game, and for every
  game once the season is over.
- **Another's city** (`GET /api/games/:id/city`): a ranked game, once finished or once its season is over. A player's
  own games, always. Never a made-up game (`fill`), whose board row has `open: false`. The answer carries `state`, the
  game as kept (no reports), by `toWire` of `src/rules/wire.ts`; the screen takes it back with `fromWire`, and opens
  the city without playing its months again. For a finished game: 406 KB of JSON, 147 KB gzipped, answered in about
  15 ms here. The server gzips any answer over 16 KB when the browser accepts it (so the dev server's is small too);
  in production nginx would also compress it (`gzip_types application/json`), and passes the server's as it is.
- **Sign-in by email:** the link is `PUBLIC_URL/?signin=<code>`; the screen passes the code to
  `POST /api/signin/email/confirm`. Signing in joins this device's player to the account with that email: if one
  exists, this device's games move to it (where both have a ranked game in the same season, the account's stays ranked
  and this device's becomes a practice game, so that two devices cannot be played for the better score); if none does,
  this player becomes it. Either way the answer's token replaces the device's old one.
- **Not set up:** with no SMTP settings, `POST /api/signin/email` answers 422 `refused`, "Signing in by email is not
  set up on this server."; with no Google client id, `POST /api/signin/google` likewise; and when Google's keys cannot
  be had, 422 `refused`, "Google sign-in could not be checked just now." Never 5xx, which the screen reads as the
  server being away.
- **`SeasonInfo.rules`** is the rules version the server plays by now (`version` in `src/rules/index.ts`), not the
  one the season opened with (which the store keeps too): it is what a screen must match.
- **`older-version`:** a screen may send its rules version in the header `X-Rules` with a month; if it is not the
  server's, the month is refused with `older-version` and `error.rules`, the server's version. Optional.
- **`out-of-step`** carries `error.game`, the summary as kept; so do `allowance` and a second ranked game refused.
- **`GET /api/health`** (no token): `{ ok, rules, busy }`, for a check that the service is up.

## Shared links and pictures (slice 9, PRD MP-14)

| Call | Body | Gives |
|---|---|---|
| `PUT /api/games/:id/picture` | the PNG's bytes | `{ kept: true }`. The share picture the player's browser drew. |
| `GET /share/:id` | | A small HTML page for a chat's link preview: title, line, picture; it sends a person on to `/?city=<id>`. No token. |
| `GET /share/:id.png` | | The picture, `image/png`. No token. |

- **Which games.** A picture is taken only for the asking player's **own ranked** game, once it is **over** (finished,
  default or replaced), and only **once** (409 `refused` after). A practice game, another's game, a game still
  playing or a made-up one (`fill`) is refused. The share page and picture are shown for exactly the games another
  player may look round (`GET /api/games/:id/city`): ranked, not made up, over or in a season that is over; any other
  id gives 404.
- **What bytes.** The server reads the body itself, whatever `Content-Type` says, and keeps it only if it is a whole
  PNG: the eight-byte signature; every chunk whole with its CRC right; `IHDR` first, of 13 bytes, saying **1200 ×
  630**; at least one `IDAT`; `IEND` last with nothing after it. At most **400 KB** (413 as soon as the length says so,
  or as the bytes pass it, and the connection is closed). The picture as the game draws it is 110 to 130 KB.
- **Where kept.** `<id>.png` in the folder `PICTURES` (default: `pictures` beside the store), the id being the one
  the store has for the game, checked again against `[A-Za-z0-9_-]`. Written to a temporary file and linked into
  place, which fails if the name is taken: two at once cannot both be kept, and no half-written file is served. A
  restarted game loses its picture (the game played again draws its own); deleting a player deletes theirs.
- **How served.** The picture with `Content-Type: image/png`, `X-Content-Type-Options: nosniff`,
  `Content-Security-Policy: default-src 'none'; sandbox`, kept an hour. The page with no script at all (a chat's
  reader runs none): `og:title`, `og:description`, `og:image` (absolute, from `PUBLIC_URL`, only if a picture is
  kept) with its size, `twitter:card`, and a `meta refresh` to the city; `Content-Security-Policy: default-src 'none';
  img-src 'self'; style-src 'unsafe-inline'`, kept five minutes. HEAD is answered for both.
- **Its words.** The title is the player's name as the server has it (checked when it was set: letters, digits and
  spaces) and the score as the server has it: "Asha Rao’s Bengaluru: 871 of 1,000", or "Bengaluru, 2026–2036: 871 of
  1,000" without a name. The line is `shareLine` (`src/share/line.ts`) worked out on the server's own kept state.
  Both are escaped. Nothing in the request but the id in the path is read.
- **nginx** passes `/share/` to the service, and `/api/games/<id>/picture` with a body limit of 410 KB
  (`deploy/nginx.conf`). The screen's dev server passes only `/api` (vite.config.ts); `/share/` links are tried
  against a built copy served by `tools/look-share.mjs`.
- **Tests:** `server/test/share.check.ts`, one attack each: no token, another's game, a practice game, a game still
  playing; HTML sent as `image/png`; a JPEG; a truncated PNG; a bad CRC; a page hidden after `IEND`; a good PNG sent
  as `text/html` (kept, served as a PNG); 1201 × 630, 630 × 1200, 1080 × 1350, 1 × 1; over 400 KB with and without a
  length; ids that try to leave the folder; a second picture; words in the query string that must not reach the page;
  pages of games not open to all; restart and deletion.

## Measured (29 September 2026, this Mac: 14 processors, shared with two others' work)

One month, in one thread (`npx vite-node server/tools/cost.ts`): **about 330 ms**, of which the model 311 ms, the
rules ending the month 16 ms, keeping the state 3 ms, loading it 1 ms. The state kept: 142 KB after a month, 156 KB
after 96. A whole game played again from its actions: about 295 ms a month.

Scripted players over HTTP (`npm run load -- --workers 1,2,4 --players 64 --seconds 45`), each ending months as fast as
the limit of 30 a minute allows, with actions now and then, reading its game after each month and the board every
fifth. The machine was 83 to 94% busy with other work throughout (load average 12 to 19), so these are low:

| Workers | Months a second | A worker | Server's processors busy | Memory (resident) | Month answered, p50 / p95 | Reads p50 / p95 |
|---|---|---|---|---|---|---|
| 1 | 3.4 | 3.4 | 1.2 | 330 MB | 2.4 s / 2.6 s | 2 / 6 ms |
| 2 | 6.0 | 3.0 | 2.3 | 470 MB | 2.8 s / 3.1 s | 3 / 10 ms |
| 4 | 11.2 | 2.8 | 4.5 | 875 MB | 2.8 s / 3.7 s | 3 / 10 ms |

The server was saturated in every run (months waited in the queue, and several hundred were refused as busy and sent
again), so the time to answer is mostly waiting; unloaded, a month is answered in about 350 ms. **About 2.9 months a
second for each processor given to the game**, the main thread's share included (0.15 to 0.2 of a processor for each
worker, for the store, the reads and the copying of states). About 90 MB for the service and **190 MB for each
worker**.

**Players a machine carries**, if each plays 12 months a day and a fifth of a day's months come in the busiest hour:
players = months a second × 3,600 / (12 × 0.2) = 1,500 × months a second. At this Mac's speed a 2-processor machine
(2 workers, sharing with nginx) does about 5 months a second, 7,500 players; 4 processors about 10, 15,000; 8 about
20, 30,000. A Linode's shared processors are slower than this Mac's; `docs/DEPLOY.md` halves these to be safe:
**about 3,500, 7,500 and 15,000 players on 2, 4 and 8 processors.** A model at B's target of 175 ms would raise each
by about half.

The board with 50,000 named players (`fill 50000`): made again in 180 ms (at most every two seconds while months are
being ended), then read in under 2 ms a page over HTTP, from any place in it.

## Made-up players for the board

`npm run fill -- 300` writes 300 named players, each with a ranked game in the current season, scores from 150 to 900
(most near 520), statuses mostly finished or in progress, a few replaced or defaulted, points near the score. **They
are written straight into the store, not played**: they have no months, cannot be played again (`verify` leaves them
out), and their cities, looked round, are the city untouched. It refuses to run on any store not marked as a scratch
one: `npm run dev` marks its store so; a real store never is.
