#!/usr/bin/env bash
set -euo pipefail
# Pinned release and archive digest; no unpinned third-party setup action.
version=1.7.12
archive="$(mktemp -d)"
trap 'rm -rf "$archive"' EXIT
curl --fail --silent --show-error --location \
  "https://github.com/rhysd/actionlint/releases/download/v${version}/actionlint_${version}_linux_amd64.tar.gz" \
  --output "$archive/actionlint.tar.gz"
printf '%s  %s\n' \
  '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8' \
  "$archive/actionlint.tar.gz" | sha256sum --check --status
tar -xzf "$archive/actionlint.tar.gz" -C "$archive" actionlint
"$archive/actionlint" -shellcheck=''
