# Peak Ooru — the server's interface

Fixed for slice 8. The server and the screen are built to it at the same time by different people.
JSON over HTTPS, under `/api`. Times are ISO 8601 in UTC. Money is whole lakh rupees. Months count from January
2026 as 0.

## Who is asking

Every request but the first carries `Authorization: Bearer <token>`. A token stands for one player on one device.
A request without a good token gets 401.

## Errors

Any refusal is a status of 4xx with `{ "error": { "code": "...", "message": "words for the player" } }`.
Codes: `unauthorised`, `not-found`, `refused` (the rules do not allow it), `allowance` (no months left today),
`out-of-step` (the month or the actions do not follow the game as the server has it), `season-over`, `name-taken`,
`name-not-allowed`, `too-many` (slow down), `older-version`.

## Players

| Call | Body | Gives |
|---|---|---|
| `POST /api/players` | none | `{ player, token }`. A new player with no name, for this device. No token needed. |
| `GET /api/me` | | `{ player }` |
| `PUT /api/me/name` | `{ name }` | `{ player }`. 3 to 20 letters, digits, spaces; checked against words not allowed. |
| `PUT /api/me/zone` | `{ zone }` | `{ player }`. The zone id the player calls home, or null. |
| `POST /api/signin/email` | `{ email }` | `{ sent: true }`. Sends a link. Always says sent, whether or not the address is known. |
| `POST /api/signin/email/confirm` | `{ code }` | `{ player, token }`. The code from the link. Joins this device's player to the account. |
| `POST /api/signin/google` | `{ credential }` | `{ player, token }`. The credential Google's button gives. |
| `POST /api/signout` | | `{}`. This device's token stops working. |
| `DELETE /api/me` | | `{}`. Deletes the player and everything kept with them. |
| `POST /api/friends` | `{ code }` | `{ friends }`. Adds the player whose friend code this is. |
| `DELETE /api/friends/:id` | | `{ friends }` |
| `GET /api/friends` | | `{ friends }` |

```ts
interface Player {
  id: string
  name: string | null
  /** Whether an email address or a Google account is joined, so that the player can play on another device. */
  signedIn: boolean
  /** Given to friends so that they can add this player. */
  friendCode: string
  zone: number | null
}
```

## Seasons

| Call | Gives |
|---|---|
| `GET /api/seasons/current` | `{ season }` |
| `GET /api/seasons` | `{ seasons }`, newest first |

```ts
interface SeasonInfo {
  id: string
  name: string
  /** One line on what is different this season. */
  twist: string
  opens: string
  closes: string
  /** The version of the rules the season is played by. A screen with another version must reload. */
  rules: number
  /** The season as the rules take it (src/rules/types.ts Season). */
  season: Season
}
```

## Games

| Call | Body | Gives |
|---|---|---|
| `POST /api/games` | `{ season, ranked }` | `{ game }`. One ranked game a season; practice games without limit. |
| `GET /api/games?season=` | | `{ games }`: the player's own, as summaries |
| `GET /api/games/:id` | | `{ game, done }`: the summary and the whole list of actions, from which the screen plays the game again |
| `POST /api/games/:id/months` | `{ month, actions, digest }` | `{ game, digest }` |
| `POST /api/games/:id/restart` | | `{ game }`. Once for a ranked game. |
| `GET /api/games/:id/city` | | `{ game, done, player, state }` for a finished game, or the player's own. `state` is the kept game without its reports, read with `fromWire` from `src/rules/wire.ts`. |

```ts
interface GameSummary {
  id: string
  season: string
  ranked: boolean
  /** The month the player is acting in: 0 to 120. 120 is finished. */
  month: number
  status: 'playing' | 'finished' | 'default' | 'replaced'
  score: number
  /** Points for the seven measures, in the order access, commute, clean, safety, fairness, money, approval. */
  points: number[]
  restarted: boolean
  allowance: { on: boolean; left: number; more: string | null }
  started: string
  ended: string | null
}
```

### Ending a month

`POST /api/games/:id/months` is the heart of it. The body is the month the player is in, the actions they did in
it in order, and the screen's own fingerprint of the game after the month has ended.

The server does the actions by its own copy of the rules, works the month's traffic out by its own copy of the model,
ends the month, and keeps the result. It answers with the game's summary and its own fingerprint.

- If `month` is not the month the server has the game in: `out-of-step`, with the summary in `error.game`.
- If any action is refused: `refused`, naming the action in `error.action` (its place in the list) and nothing is kept.
- If the player has no months left today: `allowance`.
- If the fingerprints differ, the server's is the truth. The answer is still 200: the screen sees the difference
  and plays the game again from the server's list of actions.

The fingerprint (`digest`) is `gameDigest(game)` from `src/rules/digest.ts`: eight hex digits over the score, the
money, the month, the status and the kept averages. Both sides use the same function.

## The board

| Call | Gives |
|---|---|
| `GET /api/board?season=&scope=&from=&count=` | `{ rows, total, mine }` |

`scope` is `all`, `friends` or `zone`. `mine` is the asking player's own row, wherever it stands, or null.
While a season is open, rows are games in progress by their score now, each marked with the year it has reached;
when it closes, ranks are fixed.

```ts
interface BoardRow {
  rank: number
  player: { id: string; name: string }
  game: string
  score: number
  points: number[]
  status: GameSummary['status']
  /** 2026 to 2036: the year the game has reached. */
  year: number
  /** Whether the city can be looked round: true when the game is finished. */
  open: boolean
}
```

Only players with a name appear on the board.

## Limits

The server refuses more than 30 months a minute from one player, and more than 200 new players an hour from one
address, with `too-many`. Mobile carriers in India put many phones behind one address, so the limit by address is
loose, and both limits can be set in the server's environment.

With each month the screen sends the header `X-Rules` with its rules version, and the server answers
`older-version` if its own is newer.
