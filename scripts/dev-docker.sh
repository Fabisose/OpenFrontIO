#!/usr/bin/env bash
# Startet OpenFront im Entwicklungsmodus in einem Node-24-Container.
# Client: http://localhost:9000 (im LAN: http://<deine-IP>:9000)
# Einmalig vorher: Abhaengigkeiten installieren (siehe unten, INSTALL=1).
set -euo pipefail
cd "$(dirname "$0")/.."

docker volume create openfront-home >/dev/null
docker run --rm -v openfront-home:/h node:24 chown -R "$(id -u):$(id -g)" /h

CMD='export PATH=/h/.npm-global/bin:$PATH
if ! npm -v | grep -q "^12\."; then npm install --global --ignore-scripts npm@12.1.0; fi
if [ ! -d node_modules ] || [ "${INSTALL:-0}" = 1 ]; then npm run inst; fi
exec npm run dev:host'

docker rm -f openfront-dev >/dev/null 2>&1 || true
exec docker run --rm --name openfront-dev --network host \
  -u "$(id -u):$(id -g)" \
  -e HOME=/h -e NPM_CONFIG_PREFIX=/h/.npm-global \
  -e SKIP_BROWSER_OPEN=true -e INSTALL="${INSTALL:-0}" \
  -v openfront-home:/h -v "$PWD":/app -w /app \
  node:24 bash -c "$CMD"
