# Putting Peak Ooru on the Linode

For a Linode running Ubuntu (22.04 or 24.04) or Debian (12), with nginx serving other sites already and certificates
for them. Nothing here changes those sites. The game is one service on `127.0.0.1:5210`, one SQLite file in
`/var/lib/peak-ooru`, and the game's files in `/srv/peak-ooru/www`, served by nginx.

`GAME.EXAMPLE.COM` below stands for the game's address (a name of its own, or a subdomain of one you have), and
`you@linode` for how you ssh to the machine. Commands marked **Mac** run in the game's folder on this computer; the
rest run on the machine.

## Once: eight steps

**1. Node 24.** The server needs Node 22.13 or later (it uses Node's own SQLite); 24 is the long-term one.

```
node -v    # if it says v22.13 or later, skip to step 2
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo bash -
sudo apt-get install -y nodejs
```

**2. A user and the folders.**

```
sudo useradd --system --home /var/lib/peak-ooru --shell /usr/sbin/nologin peakooru
sudo mkdir -p /srv/peak-ooru/www /srv/peak-ooru/server /var/lib/peak-ooru/backups
sudo chown -R peakooru:peakooru /var/lib/peak-ooru
sudo chown -R "$USER" /srv/peak-ooru
```

**3. The game, built and copied (Mac).**

```
deploy/ship.sh you@linode
```

It builds the game (`npm run build`) and the server (`server/build.mjs`) from the same files, and copies them, with
`deploy/`, to `/srv/peak-ooru`. The first time it ends "The service is not set up yet".

**4. The settings.**

```
sudo cp /srv/peak-ooru/deploy/peak-ooru.env /etc/peak-ooru.env
sudo chown root:peakooru /etc/peak-ooru.env && sudo chmod 640 /etc/peak-ooru.env
sudo nano /etc/peak-ooru.env
```

Set `PUBLIC_URL` to `https://GAME.EXAMPLE.COM`, and `WORKERS` to the number of processors the game may use (see "How
many players" below). Leave the mail and Google settings commented out until you want them: signing in by email or
Google then says plainly that it is not set up, and everything else works.

**5. The service, and its nightly backup.**

```
sudo cp /srv/peak-ooru/deploy/peak-ooru.service /srv/peak-ooru/deploy/peak-ooru-backup.service \
        /srv/peak-ooru/deploy/peak-ooru-backup.timer /etc/systemd/system/
sudo install -m 755 /srv/peak-ooru/deploy/peak-ooru /usr/local/bin/peak-ooru
sudo systemctl daemon-reload
sudo systemctl enable --now peak-ooru peak-ooru-backup.timer
curl -s http://127.0.0.1:5210/api/health    # {"ok":true,"rules":…,"busy":false}
```

**6. The first season.** `open` is the first season with the daily allowance on; `first` is the same with it off.

```
sudo peak-ooru season open open --name "First season" --opens 2026-11-01T00:00:00+05:30
sudo peak-ooru season list
```

A season lasts 28 days unless `--days` says otherwise, and closes itself when its time is up.

**7. A certificate for the game's address.** If the machine's certificate already covers `GAME.EXAMPLE.COM` (a
wildcard), use its paths in step 8. Otherwise, with the name pointing at the machine:

```
sudo certbot certonly --nginx -d GAME.EXAMPLE.COM
```

**8. The nginx site.**

```
sudo cp /srv/peak-ooru/deploy/nginx.conf /etc/nginx/sites-available/peak-ooru
sudo sed -i 's/GAME.EXAMPLE.COM/your.game.name/g' /etc/nginx/sites-available/peak-ooru
sudo ln -s /etc/nginx/sites-available/peak-ooru /etc/nginx/sites-enabled/peak-ooru
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` checks every site before any change takes effect; if it complains, nothing has changed. Then open
`https://GAME.EXAMPLE.COM`: the game should start at once, with no form.

**Shared links (slice 9).** The site passes `/share/` to the service as well as `/api/`: a link a player shares is
`https://GAME.EXAMPLE.COM/share/<game id>`, a small page with the title, the line and the picture for a chat's preview,
which sends a person on to the city. If an older copy of the site file is in place, copy it again: without the
`/share/` block such links open the game's start page instead, with no preview. To check, after a ranked game has
finished and its picture has been sent:

```
curl -s https://GAME.EXAMPLE.COM/share/<game id> | grep og:
curl -sI https://GAME.EXAMPLE.COM/share/<game id>.png    # 200, image/png, nosniff
```

The pictures are files in `/var/lib/peak-ooru/pictures` (one PNG a finished ranked game, at most 400 KB; about 60 to
150 KB each as drawn). They are not in the nightly backup: a lost picture costs only that game's link preview.

## Updating

**Mac:** `deploy/ship.sh you@linode`. It copies the new game and server and restarts the service (a second or two,
in which a month sent is refused as busy and the screen sends it again). Then, on the machine:

```
sudo peak-ooru verify
```

It plays every kept game again by the new rules and model, and lists any that come out differently. **If the rules
or the model changed how a game plays out** (their `version` in `src/rules/index.ts` was raised), games of a season in
progress will differ: do such updates between seasons, or open a new season at once. A screen with older rules is
told `older-version` and reloads.

## Backups

Every night at 03:30 India time the store is copied, while the service runs, to
`/var/lib/peak-ooru/backups/peak-ooru-DATE.db.gz`; the last fourteen are kept. A copy at any moment:

```
sudo peak-ooru backup /var/lib/peak-ooru/backups/now.db
```

Copy them off the machine now and then (Mac): `scp you@linode:/var/lib/peak-ooru/backups/*.gz .`

**To restore** a backup:

```
sudo systemctl stop peak-ooru
sudo -u peakooru sh -c 'cd /var/lib/peak-ooru && mv peak-ooru.db peak-ooru.db.old && rm -f peak-ooru.db-wal peak-ooru.db-shm \
  && gunzip -c backups/peak-ooru-2026-11-20.db.gz > peak-ooru.db'
sudo systemctl start peak-ooru
sudo peak-ooru verify
```

Months played since the backup are lost; their players' screens find their games out of step and take the server's.

## Mail and Google sign-in

- **Email:** any SMTP service that sends for your domain (your mail host, or a sending service). Put its host, port,
  user, password and a From address in `/etc/peak-ooru.env` and `sudo systemctl restart peak-ooru`. Port 465 uses
  TLS from the start; any other port must offer STARTTLS, which the server insists on.
- **Google:** in the Google Cloud console make an OAuth client of type "Web application", with
  `https://GAME.EXAMPLE.COM` as an authorised JavaScript origin. Put its client id in `/etc/peak-ooru.env` as
  `GOOGLE_CLIENT_ID`, and build the screen with the same id. The server checks each credential against Google's
  published keys, which it fetches from Google as needed.

## Looking after it

- `systemctl status peak-ooru`, and `journalctl -u peak-ooru -n 100` for its log. The log has no addresses and no
  email addresses in it.
- `sudo peak-ooru season list` shows the seasons and their games; `sudo peak-ooru season close` closes the current
  one early. Open the next with `season open` whenever you like; between seasons the last stays open for practice.
- The service is bound to `127.0.0.1` and reaches the world only through nginx. It needs no port opened.
- It restarts itself if it stops (`Restart=always`), and its memory is capped (`MemoryMax` in the unit) so that a fault
  cannot take the memory of your other sites.

## How many players

Each month a player ends costs the server one run of the traffic model, about a quarter of a second of one
processor; everything else (the store, the board, sign-in) is small beside it. `docs/SERVER.md` gives the figures
measured. In short, if each player plays their 12 months a day and a fifth of the day's months come in the busiest
hour of the evening:

Measured on this computer (docs/SERVER.md): about 2.9 months a second for each processor given to the game, with
each worker thread holding about 190 MB. A Linode's processors are slower than this computer's; the figures below
assume half the speed, so they are cautious.

| Linode | `WORKERS` | Memory the game uses | Months a second | Players it carries |
|---|---|---|---|---|
| 2 processors | 2 | about 0.5 GB | about 2.5 | about 3,500 |
| 4 processors | 3 | about 0.7 GB | about 5 | about 7,500 |
| 8 processors | 7 | about 1.5 GB | about 10 | about 15,000 |

Leave a processor for nginx and your other sites on the larger machines. When more players come than the workers can take, months wait a
moment, then are refused as busy and sent again by the screen; nothing is lost.
