#!/usr/bin/env bash
#
# Decide whether Vercel should build this commit at all.
#
# Exit 0 = SKIP the build, exit 1 = BUILD. That is Vercel's convention for
# `ignoreCommand` and it reads backwards, so it is spelled out at every return.
#
# Why this exists: a pull request touching one markdown file was producing a full
# production-grade build and a preview deployment. On a Hobby plan that is one
# concurrent build slot spent on a file the runtime never reads, and it puts a
# "Deployment has completed" check on a PR whose deployment proves nothing.
#
# The filter is deliberately a DENY list, not an allow list. A new top-level
# directory should build until somebody decides otherwise -- the failure mode of
# guessing wrong here is a deploy that silently never happens, which is far worse
# than one unnecessary build.

set -euo pipefail

# Always build production. A skipped build on `main` would leave the live
# deployment pinned to an older commit with nothing saying why, and the alias
# would keep serving stale code after a merge that looked successful.
if [ "${VERCEL_ENV:-}" = "production" ]; then
	echo "production: build"
	exit 1
fi

# `VERCEL_GIT_PREVIOUS_SHA` is empty on a first build, and a shallow clone may not
# have the parent commit. Both mean there is nothing to diff against, so build
# rather than guess -- an unnecessary build costs minutes, a wrongly skipped one
# costs a deployment nobody notices is missing.
base="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$base" ] || ! git cat-file -e "$base^{commit}" 2>/dev/null; then
	echo "no usable base commit: build"
	exit 1
fi

changed="$(git diff --name-only "$base" HEAD)"
if [ -z "$changed" ]; then
	echo "no changed files: build"
	exit 1
fi

# Paths the deployed application cannot read at runtime or build time.
#
# `frontend/` is the GitHub Pages SPA; `docs/` contains documentation only.
# `drizzle/` is migration SQL, applied by deploy.yml against Neon, never bundled.
# `.github/` and `.claude/` are tooling. The markdown files are documentation.
#
# NOT ignored, deliberately: `scripts/`, because this very file lives there and a
# change to the ignore logic must be exercised; and `next.config.mjs`, `vercel.json`,
# `package.json`, every source directory, and anything else not named here.
ignored='^(frontend/|docs/|drizzle/|\.github/|\.claude/|[^/]*\.md$|\.gitattributes$|\.gitignore$)'

if echo "$changed" | grep -qvE "$ignored"; then
	echo "code changed: build"
	echo "$changed" | grep -vE "$ignored" | sed 's/^/  /'
	exit 1
fi

echo "only non-deployed paths changed: skip"
echo "$changed" | sed 's/^/  /'
exit 0
