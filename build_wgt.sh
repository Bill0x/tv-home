#!/bin/bash
# Builds the TV app for installing on the Samsung TV.
#
#   ./build_wgt.sh                 # prepare build/ with the Mac's current IP
#   ./build_wgt.sh 192.168.1.72    # ...or a specific server address
#
# If Tizen Studio's command-line tools are installed and a Samsung certificate
# profile named "tvhome" exists, it also signs, packages and installs the app.
set -euo pipefail
cd "$(dirname "$0")"

IP="${1:-$(ipconfig getifaddr en0 || ipconfig getifaddr en1)}"
TV_IP="${TV_IP:-192.168.1.15}"
PROFILE="${TIZEN_PROFILE:-tvhome}"
TIZEN="${TIZEN:-$HOME/tizen-studio/tools/ide/bin/tizen}"
SDB="${SDB:-$HOME/tizen-studio/tools/sdb}"

rm -rf build
mkdir -p build
cp -R web/tv web/shared build/
cp tizen/config.xml build/
cp tizen/icon.png build/

# Point the installed app at the Mac running server.py.
sed -i '' "s#server: \"\"#server: \"http://$IP:8787\"#" build/tv/config.js
echo "Built build/ (server address http://$IP:8787)"

if [ ! -x "$TIZEN" ]; then
  echo "Tizen Studio CLI not found at $TIZEN: stopping before signing."
  exit 0
fi

"$TIZEN" package -t wgt -s "$PROFILE" -- build
"$SDB" connect "$TV_IP"
"$TIZEN" install -n "TV Home.wgt" -t "$("$SDB" devices | awk 'NR==2{print $3}')" -- build
echo "Installed on the TV: look for \"TV Home\" in Apps."
