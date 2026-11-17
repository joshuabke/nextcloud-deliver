#!/usr/bin/env bash
# Opens the release PR: from the newest main, the next version from the squashed
# PR titles since the last tag (or $1), in info.xml and package.json, and its
# section in CHANGELOG.md, on a branch release-<version>. Merging it releases.
# It works in a worktree of its own, so the checkout it runs from stays as it is.
set -euo pipefail
cd "$(dirname "$0")/.."
cliff=$PWD/node_modules/.bin/git-cliff
[ -x "$cliff" ] || npm ci --ignore-scripts --silent

git fetch --quiet --tags origin main
work=$(mktemp -d)
trap 'git worktree remove --force "$work"' EXIT
git worktree add --quiet --detach "$work" origin/main
cd "$work"

version=${1:-$("$cliff" --bumped-version 2>/dev/null)}
version=${version#v}
section=$("$cliff" --unreleased --tag "v$version" 2>/dev/null | sed "/./,\$!d" | cat -s)
if ! grep -q '^- ' <<<"$section"; then
	echo "No feat or fix since the last tag" >&2
	exit 1
fi

git switch --quiet -c "release-$version"
sed -i.bak "s|<version>[^<]*</version>|<version>$version</version>|" appinfo/info.xml && rm appinfo/info.xml.bak
npm version --no-git-tag-version --allow-same-version "$version" >/dev/null
# Below the title line and the blank line after it
{ head -n 2 CHANGELOG.md; printf '%s\n\n' "$section"; tail -n +3 CHANGELOG.md; } >CHANGELOG.md.new && mv CHANGELOG.md.new CHANGELOG.md

git commit --quiet -am "chore: Release $version"
git push --quiet -u origin "release-$version"
gh pr create --base main --title "chore: Release $version" --body "$section

Merging this releases $version: the tag, the GitHub release and the App Store. Tidy the lines on branch release-$version first where they need it."
