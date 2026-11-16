#!/usr/bin/env bash
# Prepares a release on a branch: the next version from the squashed PR titles
# since the last tag (or $1), in info.xml and package.json, and its changelog
# section in CHANGELOG.md.
set -euo pipefail
cd "$(dirname "$0")/.."
cliff=node_modules/.bin/git-cliff

version=${1:-$($cliff --bumped-version 2>/dev/null)}
version=${version#v}
section=$($cliff --unreleased --tag "v$version" 2>/dev/null | sed "/./,\$!d" | cat -s)
if ! grep -q '^- ' <<<"$section"; then
	echo "No feat or fix since the last tag" >&2
	exit 1
fi

sed -i "s|<version>[^<]*</version>|<version>$version</version>|" appinfo/info.xml
npm version --no-git-tag-version --allow-same-version "$version" >/dev/null

# Below the title line and the blank line after it
prepend() {
	{ head -n 2 "$1"; printf '%s\n\n' "$2"; tail -n +3 "$1"; } >"$1.new" && mv "$1.new" "$1"
}
prepend CHANGELOG.md "$section"
echo "$version"
