#!/usr/bin/env bash
set -euo pipefail

version=6.5.438
sha256=fcbe9ba21d9911843e3502adc178a7f549a524a4055f887bedc942e5490c6ba1
here=$(cd "$(dirname "$0")" && pwd)
out=${1:-$here/dist}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

curl -fsSL "https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-dist.zip" -o "$tmp/pdfjs.zip"
echo "${sha256}  $tmp/pdfjs.zip" | shasum -a 256 -c - >/dev/null
unzip -q "$tmp/pdfjs.zip" -d "$tmp/pdfjs"

rm -rf "$out"
mkdir -p "$out/web" "$out/build"
cp -R "$tmp/pdfjs/web/." "$out/web/"
cp "$tmp/pdfjs/build/pdf.mjs" "$tmp/pdfjs/build/pdf.worker.mjs" "$tmp/pdfjs/build/pdf.sandbox.mjs" "$out/build/"
cp "$tmp/pdfjs/LICENSE" "$out/LICENSE.pdfjs"
rm -f "$out"/web/*.map "$out"/web/debugger.* "$out"/web/compressed.tracemonkey-pldi-09.pdf

cp "$here/manifest.json" "$here/redirect.js" "$out/"
cp "$here/vim.js" "$here/vim.css" "$out/web/"
perl -0pi -e 's|(<script src="viewer.mjs" type="module"></script>)|$1\n  <script src="vim.js" type="module"></script>\n  <link rel="stylesheet" href="vim.css" />|' "$out/web/viewer.html"
grep -q 'vim.js' "$out/web/viewer.html"

echo "$out"
