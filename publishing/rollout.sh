#!/usr/bin/env bash
# Rolls publishing/publish.yml out to GitHub repositories.
#
# Usage: publishing/rollout.sh owner/repo [owner/repo ...]
#
# For each repository: creates the `npm-publish` environment that only the
# default branch can deploy to, then commits publish.yml to the default
# branch (replacing an older copy). It publishes nothing by itself: the
# workflow only runs when a package.json changes, and npm refuses it until the
# package trusts it (`npm trust github <package> --repo <repo> --file
# publish.yml --env npm-publish --allow-publish`).
set -uo pipefail

template="$(dirname "$0")/publish.yml"

for repo in "$@"; do
	branch=$(gh api "repos/$repo" -q .default_branch) || { echo "$repo: not found"; continue; }

	gh api -X PUT "repos/$repo/environments/npm-publish" --silent \
		--input - <<<'{"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' ||
		{ echo "$repo: could not create the npm-publish environment"; continue; }
	policies=$(gh api "repos/$repo/environments/npm-publish/deployment-branch-policies" -q '.branch_policies[].name')
	if ! grep -qx "$branch" <<<"$policies"; then
		gh api -X POST "repos/$repo/environments/npm-publish/deployment-branch-policies" \
			-f name="$branch" -f type=branch --silent ||
			{ echo "$repo: could not limit npm-publish to $branch"; continue; }
	fi

	content=$(sed "s/branches: \[main\]/branches: [$branch]/; s/which only main can deploy to/which only $branch can deploy to/" "$template" | base64 -w0)
	path="repos/$repo/contents/.github/workflows/publish.yml"
	sha=$(gh api "$path?ref=$branch" -q .sha 2>/dev/null)
	if [ -n "$sha" ] && [ "$(gh api -H 'Accept: application/vnd.github.raw' "$path?ref=$branch")" = "$(base64 -d <<<"$content")" ]; then
		echo "$repo: up to date"
		continue
	fi
	args=(-f message="Publish from GitHub Actions with npm trusted publishing" -f content="$content" -f branch="$branch")
	[ -n "$sha" ] && args+=(-f sha="$sha")
	if gh api -X PUT "repos/$repo/contents/.github/workflows/publish.yml" "${args[@]}" --silent; then
		echo "$repo: workflow committed to $branch"
	else
		echo "$repo: commit refused (protected $branch?)"
	fi
done
