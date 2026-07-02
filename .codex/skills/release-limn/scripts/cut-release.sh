#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: cut-release.sh <version|vversion> [--skip-e2e] [--no-push] [--allow-non-main]

Bumps Limn release versions, validates, commits, tags, and pushes main plus the tag.
USAGE
}

version_arg=""
skip_e2e=0
push_release=1
allow_non_main=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-e2e)
      skip_e2e=1
      ;;
    --no-push)
      push_release=0
      ;;
    --allow-non-main)
      allow_non_main=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      if [ -n "$version_arg" ]; then
        echo "Only one version argument is allowed." >&2
        usage >&2
        exit 2
      fi
      version_arg="$1"
      ;;
  esac
  shift
done

if [ -z "$version_arg" ]; then
  usage >&2
  exit 2
fi

version="${version_arg#v}"
tag="v$version"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]+)?$ ]]; then
  echo "Invalid semver: $version_arg" >&2
  exit 2
fi

script_dir="$(CDPATH= cd -P -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repo_root="$(CDPATH= cd -P -- "$script_dir/../../../.." && pwd -P)"
cd "$repo_root"

if [ ! -f package.json ] || [ ! -f src-tauri/tauri.conf.json ]; then
  echo "Could not locate Limn repo root from $script_dir" >&2
  exit 1
fi

origin_url="$(git remote get-url origin 2>/dev/null || true)"
if ! [[ "$origin_url" =~ evanviera/limn(\.git)?$ ]]; then
  echo "origin does not appear to be evanviera/limn: $origin_url" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$allow_non_main" -ne 1 ] && [ "$branch" != "main" ]; then
  echo "Release must run from main. Current branch: $branch" >&2
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "Worktree is not clean. Commit, stash, or remove unrelated changes before releasing." >&2
  git status --short
  exit 1
fi

git fetch origin --tags

if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "Local tag already exists: $tag" >&2
  exit 1
fi

if git ls-remote --exit-code --tags origin "refs/tags/$tag" >/dev/null 2>&1; then
  echo "Remote tag already exists: $tag" >&2
  exit 1
fi

npm run release:version -- "$version"

node - "$version" <<'NODE'
const fs = require("node:fs");
const version = process.argv[2];

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(fs.readFileSync("package-lock.json", "utf8"));
const tauriConf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const cargoToml = fs.readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoLock = fs.readFileSync("src-tauri/Cargo.lock", "utf8");

const checks = [
  ["package.json", packageJson.version],
  ["package-lock.json", packageLock.version],
  ['package-lock.json packages[""]', packageLock.packages?.[""]?.version],
  ["src-tauri/tauri.conf.json", tauriConf.version],
  ["src-tauri/Cargo.toml", cargoToml.match(/^version = "([^"]+)"/m)?.[1]],
  ["src-tauri/Cargo.lock limn", cargoLock.match(/name = "limn"\nversion = "([^"]+)"/)?.[1]],
];

const failures = checks.filter(([, actual]) => actual !== version);
if (failures.length) {
  for (const [name, actual] of failures) {
    console.error(`${name} has ${actual ?? "<missing>"}; expected ${version}`);
  }
  process.exit(1);
}
NODE

npm run build:web
cargo check --manifest-path src-tauri/Cargo.toml
npm run test:storage

if [ "$skip_e2e" -eq 1 ]; then
  echo "Skipping e2e tests by request."
else
  npm run test:e2e
fi

git diff --check
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json

if git diff --cached --quiet; then
  echo "No version changes were staged." >&2
  exit 1
fi

git commit -m "Prepare $tag release"
git tag "$tag"

if [ "$push_release" -eq 1 ]; then
  git push origin "$branch"
  git push origin "$tag"
else
  echo "Created commit and tag locally; push skipped by --no-push."
fi

echo "Release prep complete for $tag."
