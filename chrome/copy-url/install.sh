#!/usr/bin/env bash
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$HOME/.local/share/chrome-extensions/copy-url}

mkdir -p "$out"
rsync -a --delete --exclude e2e.py --exclude install.sh --exclude evidence "$here/" "$out/"
echo "$out"
