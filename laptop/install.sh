#!/usr/bin/env bash
# The laptop half of a deploy. deploy.sh pipes this in over ssh and runs it as root:
#   install.sh STAMP
# It unpacks /tmp/claude-portfolio-STAMP.tgz as a new release, installs and tests it,
# and only then switches /opt/claude-portfolio/current and restarts the API. A failed
# install or test leaves the live release alone.
set -euo pipefail

stamp=${1:?usage: install.sh STAMP}
APP=claude-portfolio
BASE=/opt/$APP
REL=$BASE/releases/$stamp
TGZ=/tmp/$APP-$stamp.tgz
DATA=/srv/$APP
ETC=/etc/$APP
SOCK=/run/caddy-upstreams/$APP/site.sock

say() { printf '%s\n' "$*"; }
changed() { ! cmp -s "$1" "$2"; }
as_app() { sudo -u "$APP" env -i HOME="$BASE" PATH=/usr/local/bin:/usr/bin:/bin "$@"; }

# ---- first run: Node, the user, the folders ---------------------------------------------
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  apt-get install -y -q nodejs npm >/dev/null
  say "installed $(node --version) and npm $(npm --version)"
fi
id "$APP" >/dev/null 2>&1 || useradd -r -m -d "$BASE" -s /usr/sbin/nologin "$APP"
install -d -o "$APP" -g "$APP" -m 0755 "$BASE" "$BASE/releases"
install -d -o "$APP" -g "$APP" -m 0750 "$DATA" "$DATA/congressional"
install -d -o root -g "$APP" -m 0750 "$ETC"

# ---- unpack, install, test ----------------------------------------------------------------
rm -rf "$REL"
install -d -o "$APP" -g "$APP" "$REL"
tar xzf "$TGZ" -C "$REL"
rm -f "$TGZ"
chown -R "$APP:$APP" "$REL"
cd "$REL"
for pkg in data-gatherers api; do
  (cd "$pkg" && as_app npm ci --omit=dev --no-audit --no-fund --loglevel=error)
done
(cd congressional && as_app UV_PYTHON_PREFERENCE=only-system uv sync -q --locked --extra dev)
tests_ok=1
for pkg in data-gatherers api; do
  (cd "$pkg" && as_app timeout 300 node --test --test-reporter=dot) || tests_ok=0
done
(cd congressional && as_app timeout 300 .venv/bin/python -m pytest -q -p no:cacheprovider) || tests_ok=0
if [ "$tests_ok" != 1 ]; then
  say "tests failed, so $stamp was installed and left unused. Nothing was restarted."
  exit 1
fi

# ---- switch -------------------------------------------------------------------------------
ln -sfn "$REL" "$BASE/current.new"
mv -T "$BASE/current.new" "$BASE/current"
say "current is $stamp"

# ---- config, units, helpers -------------------------------------------------------------
U=$REL/laptop/units
if changed "$U/$APP.env" "$ETC/$APP.env"; then
  install -m 0640 -o root -g "$APP" "$U/$APP.env" "$ETC/$APP.env"
fi
UNITS="$APP-api.service $APP-bot.service $APP-bot.timer $APP-force.path
       $APP-congressional.service $APP-congressional.timer
       $APP-backup.service $APP-backup.timer"
reload=0
retrigger=""
for unit in $UNITS; do
  if changed "$U/$unit" "/etc/systemd/system/$unit"; then
    install -m 0644 "$U/$unit" "/etc/systemd/system/$unit"
    reload=1
    case "$unit" in *.timer|*.path) retrigger="$retrigger $unit" ;; esac
  fi
done
[ "$reload" = 1 ] && systemctl daemon-reload
install -m 0755 "$U/$APP" "/usr/local/bin/$APP"
install -m 0755 "$U/$APP-congressional.sh" "/usr/local/bin/$APP-congressional"
install -m 0755 "$U/$APP-backup.sh" "/usr/local/bin/$APP-backup"
if changed "$U/$APP.tmpfiles.conf" "/etc/tmpfiles.d/$APP.conf"; then
  install -m 0644 "$U/$APP.tmpfiles.conf" "/etc/tmpfiles.d/$APP.conf"
fi
systemd-tmpfiles --create "/etc/tmpfiles.d/$APP.conf"

if [ ! -f "$ETC/secrets.env" ]; then
  say "no $ETC/secrets.env yet: the API refuses every request and the bot can't run until it exists"
fi

# ---- start and check ----------------------------------------------------------------------
systemctl enable -q "$APP-api.service"
systemctl restart "$APP-api.service"
systemctl enable -q --now "$APP-bot.timer" "$APP-force.path" "$APP-congressional.timer"
# A changed schedule only takes effect once its timer is restarted. Never restart a
# .service here: the bot must not be started by a deploy.
for unit in $retrigger; do
  if systemctl is-enabled --quiet "$unit"; then systemctl restart "$unit"; fi
done
if [ -f "$ETC/aws.env" ]; then
  systemctl enable -q --now "$APP-backup.timer"
else
  say "no $ETC/aws.env yet, so the backup timer stays off"
fi
ok=0
for _ in $(seq 1 20); do
  if curl -fsS --unix-socket "$SOCK" http://api/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  say "the API didn't answer on $SOCK"
  journalctl -u "$APP-api" -n 40 --no-pager
  exit 1
fi
say "the API answers on its socket"

# ---- Caddy ----------------------------------------------------------------------------------
caddy_rc=0
if [ -d /etc/caddy-sites ] && changed "$U/$APP.caddy" "/etc/caddy-sites/$APP.caddy"; then
  caddy=$(docker ps -q -f label=com.docker.compose.project=almosthadai -f label=com.docker.compose.service=caddy)
  prev=$(mktemp)
  had=0
  if [ -f "/etc/caddy-sites/$APP.caddy" ]; then cp "/etc/caddy-sites/$APP.caddy" "$prev"; had=1; fi
  install -m 0644 "$U/$APP.caddy" "/etc/caddy-sites/$APP.caddy"
  if [ -n "$caddy" ] \
    && docker exec "$caddy" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null 2>&1 \
    && docker exec "$caddy" caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile; then
    say "Caddy reloaded with the $APP site"
  else
    say "Caddy refused the $APP site, so the previous one is back"
    if [ "$had" = 1 ]; then install -m 0644 "$prev" "/etc/caddy-sites/$APP.caddy"; else rm -f "/etc/caddy-sites/$APP.caddy"; fi
    caddy_rc=1
  fi
  rm -f "$prev"
fi

# ---- keep three releases ------------------------------------------------------------------
live=$(readlink -f "$BASE/current")
ls -1dt "$BASE"/releases/* | tail -n +4 | while read -r old; do
  [ "$(readlink -f "$old")" = "$live" ] || rm -rf "$old"
done

exit "$caddy_rc"
