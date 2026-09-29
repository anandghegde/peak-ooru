#!/bin/sh
# Builds the game and its server on this computer and copies them to the machine, then restarts the service if it is
# set up. Run from the game's folder, with the address you ssh to:
#   deploy/ship.sh you@your-linode
# The screen and the server are built from the same files at the same moment, so that their rules are the same.
set -eu
TARGET=${1:?Give the address you ssh to, such as you@your-linode.}

npm run build
(cd server && node build.mjs)

rsync -az --delete dist/ "$TARGET:/srv/peak-ooru/www/"
rsync -az --delete server/dist server/package.json "$TARGET:/srv/peak-ooru/server/"
rsync -az --delete deploy/ "$TARGET:/srv/peak-ooru/deploy/"

ssh "$TARGET" 'if systemctl list-unit-files peak-ooru.service >/dev/null 2>&1 && [ -f /etc/systemd/system/peak-ooru.service ]; then
  sudo systemctl restart peak-ooru && sleep 3 && curl -fsS http://127.0.0.1:5210/api/health && echo
else
  echo "Copied. The service is not set up yet: see docs/DEPLOY.md."
fi'
