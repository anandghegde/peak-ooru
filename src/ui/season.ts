import type { BoardRow, Friend, GameSummary, Net, Scope, SeasonInfo } from '../net'
import { ApiError } from '../net'
import { BoardList, howItStands, ordinal } from './board'
import { element } from './controls'
import { grouped } from './format'
import { setSound, soundOn } from '../sound'

/*
 * The season's page (PRD UI-10, UI-16): the season, its twist and the days left; the player's game; the board; and,
 * out of the way, the player's name, signing in, friends, home zone and deleting. Nothing here is asked of a player
 * who does not open it.
 */

export interface SeasonHooks {
  net: Net
  /** The zones, by name, for choosing a home zone. */
  zones(): { id: number; name: string }[]
  /** The game being played now. */
  playing(): GameSummary | null
  /** Switches to one of the player's games. */
  play(game: GameSummary): void
  /** Starts a practice game, or the ranked game again (once). */
  practice(): void
  restart(): void
  /** Looks round another player's finished city. */
  look(row: BoardRow): void
  /** Draws the page again. */
  redraw(): void
  /** The player's name or sign-in changed: games may need to be found again. */
  signedIn(): void
  /** Starts the introduction again. */
  howToPlay?(): void
}

type View = 'board' | 'games' | 'you'
let view: View = 'board'
let scope: Scope = 'all'
/** What the "You" part is asking, between drawings. */
let asking: { email?: string; sent?: boolean; deleting?: boolean; message?: string } = {}
let friends: Friend[] | null = null
let games: GameSummary[] | null = null

const NAME_LATER = 'peakooru.name-later'

function button(className: string, text: string, run: () => void): HTMLButtonElement {
  const b = element('button', className, text)
  b.type = 'button'
  b.addEventListener('click', run)
  return b
}

/**
 * The season's twist as a player reads it. Seasons opened before slice 9 keep builders' words on the server ("The
 * allowance is off while the game is being built"), which are left out here.
 */
export function twistWords(twist: string): string {
  return twist.replace(/\s*The allowance is off while the game is being built\./, '').replace(/, carried over to 36\./, '.')
}

/** Days left in the season, in words. */
export function daysLeft(info: SeasonInfo): string {
  const days = Math.ceil((Date.parse(info.closes) - Date.now()) / 86_400_000)
  const date = new Date(info.closes).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })
  if (days <= 0) return 'Closed'
  return `${days === 1 ? 'One day' : `${days} days`} left · closes ${date}`
}

/** A form of one field and a button, which says what went wrong beside it. */
function oneField(label: string, value: string, action: string, run: (value: string) => Promise<string | null>, type = 'text'): HTMLElement {
  const form = element('form', 'one-field')
  const input = element('input')
  input.type = type
  input.value = value
  input.setAttribute('aria-label', label)
  input.placeholder = label
  const go = element('button', 'commit', action)
  go.type = 'submit'
  const said = element('p', 'small muted one-field-said')
  form.append(input, go, said)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    go.disabled = true
    void run(input.value).then((words) => {
      said.textContent = words ?? ''
      said.classList.toggle('red', !!words)
    }).finally(() => (go.disabled = false))
  })
  return form
}

const reason = (error: unknown) => error instanceof ApiError
  ? error.code === 'offline' ? 'The server cannot be reached just now. Try again in a moment.' : error.message
  : String(error)

/** Asks for a name, for the board. Resolves with the words to show if it failed, or null. */
export async function setName(net: Net, name: string): Promise<string | null> {
  try {
    const { player } = await net.server.setName(name.trim())
    net.session.player = player
    net.save()
    return null
  } catch (error) {
    return reason(error)
  }
}

/** The box that asks for a name, when there is none: for the board, and at the end of a game. */
export function nameBox(net: Net, why: string, done: () => void, later?: () => void): HTMLElement {
  const box = element('div', 'name-box')
  box.append(element('p', 'name-box-why', why))
  box.append(oneField('Your name', '', 'Save', async (value) => {
    const failed = await setName(net, value)
    if (!failed) done()
    return failed
  }))
  if (later) box.append(button('quiet', 'Not now', later))
  return box
}

/** Draws the season's page. */
export function drawSeason(body: HTMLElement, hooks: SeasonHooks): void {
  const { net } = hooks
  const info = net.session.season
  const here = net.isHere(hooks.playing()?.id ?? null)
  const head = element('div', 'season-head')
  if (info) {
    head.append(element('p', 'season-name', info.name), element('p', 'small', twistWords(info.twist)), element('p', 'small muted', daysLeft(info)))
  } else head.append(element('p', 'small muted', 'The season will show here once the server can be reached.'))
  body.append(head)
  const now = hooks.playing()
  if (now && !now.ranked) {
    body.append(element('p', 'small practice-note', here
      ? 'You are playing a practice game kept in this browser. It does not count on the board.'
      : 'You are playing a practice game. It does not count on the board.'))
  }
  const waiting = net.outbox.queue.length
  if (waiting) {
    body.append(element('p', 'small muted', net.outbox.offline
      ? `${waiting} ${waiting === 1 ? 'month is' : 'months are'} kept here until the server can be reached.`
      : `${waiting} ${waiting === 1 ? 'month is' : 'months are'} on the way to the server.`))
  }

  const seg = element('div', 'segments season-tabs')
  seg.setAttribute('role', 'group')
  seg.setAttribute('aria-label', 'Season')
  for (const [v, label] of [['board', 'The board'], ['games', 'Your games'], ['you', 'You']] as const) {
    const b = button('', label, () => {
      view = v
      hooks.redraw()
    })
    b.dataset.view = v
    b.setAttribute('aria-pressed', String(view === v))
    seg.append(b)
  }
  body.append(seg)
  if (view === 'board') drawBoard(body, hooks)
  else if (view === 'games') drawGames(body, hooks)
  else drawYou(body, hooks)
}

function drawBoard(body: HTMLElement, hooks: SeasonHooks): void {
  const { net } = hooks
  const info = net.session.season
  if (!info || !net.session.token) {
    body.append(element('p', 'small muted', 'The board needs the game’s server, which cannot be reached just now.'))
    return
  }
  const player = net.session.player
  let later = false
  try {
    later = sessionStorage.getItem(NAME_LATER) === '1'
  } catch {
    // Asked again next time.
  }
  if (!player?.name && !later) {
    // The server's board takes a moment to take the new name in: asked again after it.
    const named = () => {
      hooks.redraw()
      setTimeout(() => hooks.redraw(), 1500)
    }
    body.append(nameBox(net, 'Choose a name to put your game on the board. Others see only the name.', named, () => {
      try {
        sessionStorage.setItem(NAME_LATER, '1')
      } catch {
        // Asked again next time.
      }
      hooks.redraw()
    }))
  }
  const scopes = element('div', 'segments board-scopes')
  scopes.setAttribute('role', 'group')
  scopes.setAttribute('aria-label', 'Whose scores')
  for (const [s, label] of [['all', 'Everyone'], ['friends', 'Friends'], ['zone', 'My zone']] as const) {
    const b = button('', label, () => {
      scope = s
      hooks.redraw()
    })
    b.dataset.scope = s
    b.setAttribute('aria-pressed', String(scope === s))
    b.disabled = s === 'zone' && player?.zone == null
    if (b.disabled) b.title = 'Choose your home zone under You'
    scopes.append(b)
  }
  body.append(scopes)
  const head = element('div', 'board-row board-head')
  head.append(element('span', 'board-rank', '#'), element('span', 'board-name', 'Name'), element('span', 'board-bars-head', 'Measures'), element('span', 'board-score', 'Score'))
  body.append(head)
  const list = new BoardList(scope, body, {
    fetch: (s, from, count) => net.server.board(info.id, s, from, count),
    look: (row) => hooks.look(row),
    mine: () => hooks.playing(),
  })
  body.append(list.root)
  body.append(element('p', 'muted small board-foot', 'Games in progress are ranked by their score now. Ranks are fixed when the season closes.'))
}

function drawGames(body: HTMLElement, hooks: SeasonHooks): void {
  const { net } = hooks
  const info = net.session.season
  const now = hooks.playing()
  if (info && net.session.token && games === null) {
    games = []
    void net.server.games(info.id).then((g) => {
      games = g.games
      hooks.redraw()
    }, () => (games = null))
  }
  const all = [...(games ?? [])]
  if (now && !all.some((g) => g.id === now.id)) all.unshift(now)
  const ranked = all.find((g) => g.ranked && g.season === info?.id)
  body.append(element('h3', '', 'Your ranked game'))
  if (ranked) {
    const box = element('div', 'game-line')
    box.append(element('span', '', `${howItStands({ status: ranked.status, year: 2026 + Math.floor(Math.min(ranked.month, 119) / 12) })} · score ${grouped(ranked.score)}`))
    if (ranked.id !== now?.id) box.append(button('commit', 'Play it', () => hooks.play(ranked)))
    body.append(box)
    if (!ranked.restarted) {
      body.append(element('p', 'small muted', 'You may start your ranked game again once this season.'))
      body.append(button('quiet', 'Start my ranked game again', () => hooks.restart()))
    } else body.append(element('p', 'small muted', 'You have started it again once, which is all a season allows.'))
  } else if (net.session.token) body.append(element('p', 'small muted', 'Your ranked game will show here.'))
  else {
    body.append(element('p', 'small muted', 'Your ranked game needs the server, which could not be reached.'))
    body.append(button('commit', 'Try the server again', () => hooks.signedIn()))
  }
  body.append(element('h3', '', 'Practice'))
  body.append(element('p', 'small muted', 'Practice games do not count and have no daily limit. Play as many as you like.'))
  for (const g of all.filter((x) => !x.ranked)) {
    const box = element('div', 'game-line')
    box.append(element('span', '', `Practice · ${howItStands({ status: g.status, year: 2026 + Math.floor(Math.min(g.month, 119) / 12) })}`))
    if (g.id !== now?.id) box.append(button('quiet', 'Play it', () => hooks.play(g)))
    else box.append(element('span', 'small muted', 'Playing now'))
    body.append(box)
  }
  body.append(button('commit', 'New practice game', () => hooks.practice()))
}

function drawYou(body: HTMLElement, hooks: SeasonHooks): void {
  const { net } = hooks
  // Sound: one switch, remembered on this device.
  body.append(element('h3', '', 'Sound'))
  const sound = element('div', 'segments sound-switch')
  sound.setAttribute('role', 'group')
  sound.setAttribute('aria-label', 'Sound')
  for (const [on, label] of [[true, 'On'], [false, 'Off']] as const) {
    const b = button('', label, () => {
      setSound(on)
      hooks.redraw()
    })
    b.setAttribute('aria-pressed', String(soundOn() === on))
    sound.append(b)
  }
  body.append(sound)
  if (hooks.howToPlay) {
    body.append(element('h3', '', 'How to play'))
    body.append(element('p', 'small muted', 'The first month again, step by step, in the game you are playing.'))
    body.append(button('quiet', 'Show me how to play', () => hooks.howToPlay!()))
  }
  const player = net.session.player
  if (!player || !net.session.token) {
    body.append(element('p', 'small muted', 'Your name, signing in and friends need the game’s server, which cannot be reached just now.'))
    return
  }
  if (asking.message) body.append(element('p', 'small', asking.message))
  body.append(element('h3', '', 'Your name'))
  body.append(element('p', 'small muted', player.name ? 'Shown on the board.' : 'You have no name yet, so your game is not on the board.'))
  body.append(oneField('Your name', player.name ?? '', 'Save', async (value) => {
    const failed = await setName(net, value)
    if (!failed) hooks.redraw()
    return failed
  }))

  body.append(element('h3', '', 'Home zone'))
  const select = element('select', 'zone-select')
  select.setAttribute('aria-label', 'Home zone')
  select.append(Object.assign(element('option', '', 'None'), { value: '' }))
  for (const z of [...hooks.zones()].sort((a, b) => a.name.localeCompare(b.name))) {
    select.append(Object.assign(element('option', '', z.name), { value: String(z.id), selected: z.id === player.zone }))
  }
  select.addEventListener('change', () => {
    void net.server.setZone(select.value === '' ? null : Number(select.value)).then(({ player: p }) => {
      net.session.player = p
      net.save()
    }, (error) => {
      asking.message = reason(error)
      hooks.redraw()
    })
  })
  body.append(element('p', 'small muted', 'For the board of players from your part of the city.'), select)

  body.append(element('h3', '', 'Play on another device'))
  if (player.signedIn) {
    body.append(element('p', 'small', 'You are signed in. Sign in on another device to carry on your game there.'))
  } else if (asking.sent) {
    body.append(element('p', 'small', `A link is on its way to ${asking.email}. Open it on the device you want to play on.`))
    body.append(button('quiet', 'Use another address', () => {
      asking = {}
      hooks.redraw()
    }))
  } else {
    body.append(element('p', 'small muted', 'Your game is kept against this device. Sign in to play it on another device as well.'))
    body.append(oneField('Email address', asking.email ?? '', 'Send a link', async (email) => {
      try {
        await net.server.signInEmail(email.trim())
        asking = { email: email.trim(), sent: true }
        hooks.redraw()
        return null
      } catch (error) {
        return reason(error)
      }
    }, 'email'))
    const google = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
    if (google) body.append(googleButton(google, net, hooks))
  }

  body.append(element('h3', '', 'Friends'))
  const link = `${location.origin}${location.pathname}?friend=${encodeURIComponent(player.friendCode)}`
  const code = element('p', 'small')
  code.append('Your friend code is ', element('strong', '', player.friendCode), '. A friend who adds it sees you on their board.')
  body.append(code)
  body.append(button('quiet', 'Copy a link to send a friend', () => {
    void navigator.clipboard?.writeText(link).then(() => {
      asking.message = 'The link is copied. Send it to a friend.'
      hooks.redraw()
    }, () => {
      asking.message = link
      hooks.redraw()
    })
  }))
  body.append(oneField('A friend’s code', '', 'Add', async (value) => {
    try {
      friends = (await net.server.addFriend(value.trim())).friends
      hooks.redraw()
      return null
    } catch (error) {
      return reason(error)
    }
  }))
  if (friends === null) {
    friends = []
    void net.server.friends().then((f) => {
      friends = f.friends
      hooks.redraw()
    }, () => (friends = null))
  }
  for (const f of friends ?? []) {
    const line = element('div', 'game-line')
    line.append(element('span', '', f.name ?? 'A player with no name yet'), button('quiet', 'Remove', () => {
      void net.server.dropFriend(f.id).then((r) => {
        friends = r.friends
        hooks.redraw()
      })
    }))
    body.append(line)
  }

  body.append(element('h3', '', 'Leaving'))
  if (player.signedIn) {
    body.append(button('quiet', 'Sign out on this device', () => {
      void net.server.signOut().catch(() => null).finally(() => {
        net.forget()
        location.reload()
      })
    }))
  }
  if (!asking.deleting) {
    body.append(button('quiet', 'Delete me and everything kept about me', () => {
      asking.deleting = true
      hooks.redraw()
    }))
  } else {
    body.append(element('p', 'small red', 'This deletes your name, your games and your place on the board, for good. It cannot be undone.'))
    const row = element('div', 'outlook-buttons')
    row.append(button('commit', 'Delete everything', () => {
      void net.server.deleteMe().then(async () => {
        net.forget()
        const { forgetAll } = await import('../game/keep')
        await forgetAll()
        location.reload()
      }, (error) => {
        asking = { message: reason(error) }
        hooks.redraw()
      })
    }), button('quiet', 'Keep them', () => {
      asking.deleting = false
      hooks.redraw()
    }))
    body.append(row)
  }
  body.append(element('p', 'muted small', 'We keep your email address if you give one, your name, and your games. Nothing else, and no tracking.'))
}

/** Google's own button, loaded only when the player opens this page and Google sign-in is set up. */
function googleButton(clientId: string, net: Net, hooks: SeasonHooks): HTMLElement {
  const box = element('div', 'google-box')
  type Google = { accounts: { id: { initialize(o: object): void; renderButton(el: HTMLElement, o: object): void } } }
  const draw = () => {
    const g = (window as unknown as { google?: Google }).google
    if (!g) return
    g.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }: { credential: string }) => {
        void net.server.signInGoogle(credential).then(({ player, token }) => {
          net.signedIn(player, token)
          hooks.signedIn()
        }, (error) => {
          asking.message = reason(error)
          hooks.redraw()
        })
      },
    })
    g.accounts.id.renderButton(box, { theme: 'outline', size: 'large', text: 'signin_with' })
  }
  if ((window as unknown as { google?: Google }).google) draw()
  else {
    const script = element('script')
    script.src = 'https://accounts.google.com/gsi/client'
    script.async = true
    script.addEventListener('load', draw)
    document.head.append(script)
  }
  return box
}

/** Forgets what the page fetched, so that it is fetched again when next drawn. */
export function forgetSeasonPage(): void {
  games = null
  friends = null
}

/** The rank in words for the ending: "48th of 1,203 this season". */
export function rankWords(row: BoardRow, total: number): string {
  return `${ordinal(row.rank)} of ${grouped(total)} this season`
}
