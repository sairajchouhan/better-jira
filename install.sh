#!/bin/sh
set -eu

REPO="${BETTER_JIRA_REPO:-sairajchouhan/better-jira}"
VERSION="${BETTER_JIRA_VERSION:-latest}"
INSTALL_DIR="${BETTER_JIRA_INSTALL_DIR:-$HOME/.local/bin}"

say() {
  printf '%s\n' "$*"
}

fail() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "required command '$1' is not installed"
}

need_cmd curl
need_cmd uname

OS_RAW=$(uname -s)
ARCH_RAW=$(uname -m)

case "$OS_RAW" in
  Darwin) OS="darwin" ;;
  Linux)  OS="linux" ;;
  *)      fail "unsupported operating system: $OS_RAW (macOS and Linux are supported)" ;;
esac

case "$ARCH_RAW" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)             fail "unsupported CPU architecture: $ARCH_RAW (arm64 and x64 are supported)" ;;
esac

ASSET="better-jira-${OS}-${ARCH}"
TMP_DIR=$(mktemp -d "${TMPDIR:-/tmp}/better-jira-install.XXXXXX")
trap 'rm -rf "$TMP_DIR"' EXIT INT TERM

fetch_public() {
  url="$1"
  dest="$2"
  curl -fsSL --retry 3 --retry-delay 1 -o "$dest" "$url"
}

# For private repos, pass GITHUB_TOKEN (with repo read access) to download release assets via the GitHub API.
download_release_files() {
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    if [ "$VERSION" = "latest" ]; then
      api_url="https://api.github.com/repos/${REPO}/releases/latest"
    else
      api_url="https://api.github.com/repos/${REPO}/releases/tags/${VERSION}"
    fi
    release_json="${TMP_DIR}/release.json"
    curl -fsSL \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      -o "$release_json" "$api_url" || fail "could not read release metadata from ${api_url}"

    asset_url=$(awk -v name="\"$ASSET\"" '
      /"url": "https:\/\/api\.github\.com\/repos\/.*\/releases\/assets\// { last_url=$2 }
      $1 == "\"name\":" && $2 ~ name { gsub(/[",]/, "", last_url); print last_url; exit }
    ' "$release_json")
    checksum_url=$(awk '
      /"url": "https:\/\/api\.github\.com\/repos\/.*\/releases\/assets\// { last_url=$2 }
      $1 == "\"name\":" && $2 ~ /"checksums\.txt"/ { gsub(/[",]/, "", last_url); print last_url; exit }
    ' "$release_json")

    [ -n "$asset_url" ] || fail "release asset ${ASSET} not found in ${REPO} (${VERSION})"
    [ -n "$checksum_url" ] || fail "checksums.txt not found in ${REPO} (${VERSION})"

    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/octet-stream" \
      -o "${TMP_DIR}/${ASSET}" "$asset_url" || fail "failed to download ${ASSET}"
    curl -fsSL -H "Authorization: Bearer ${GITHUB_TOKEN}" -H "Accept: application/octet-stream" \
      -o "${TMP_DIR}/checksums.txt" "$checksum_url" || fail "failed to download checksums.txt"
  else
    if [ "$VERSION" = "latest" ]; then
      base_url="https://github.com/${REPO}/releases/latest/download"
    else
      base_url="https://github.com/${REPO}/releases/download/${VERSION}"
    fi
    fetch_public "${base_url}/${ASSET}" "${TMP_DIR}/${ASSET}" || fail "failed to download ${base_url}/${ASSET}"
    fetch_public "${base_url}/checksums.txt" "${TMP_DIR}/checksums.txt" || fail "failed to download ${base_url}/checksums.txt"
  fi
}

verify_checksum() {
  expected=$(awk -v target="$ASSET" '$2 == target || $2 == ("*" target) { print $1; exit }' "${TMP_DIR}/checksums.txt")
  [ -n "$expected" ] || fail "checksum for ${ASSET} not found in checksums.txt"
  if command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "${TMP_DIR}/${ASSET}" | awk '{print $1}')
  elif command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "${TMP_DIR}/${ASSET}" | awk '{print $1}')
  else
    fail "neither shasum nor sha256sum is installed to verify download integrity"
  fi
  [ "$actual" = "$expected" ] || fail "checksum mismatch for ${ASSET} (expected ${expected}, got ${actual})"
}

say "Installing better-jira (${OS}/${ARCH}) from ${REPO} (${VERSION})..."
download_release_files
verify_checksum

mkdir -p "$INSTALL_DIR"
mv "${TMP_DIR}/${ASSET}" "${INSTALL_DIR}/better-jira"
chmod 755 "${INSTALL_DIR}/better-jira"

say ""
say "Installed better-jira to ${INSTALL_DIR}/better-jira"

case ":${PATH}:" in
  *":${INSTALL_DIR}:"*)
    say ""
    say "Run: better-jira"
    ;;
  *)
    say ""
    say "Add ${INSTALL_DIR} to your PATH to run 'better-jira' from anywhere:"
    say "  export PATH=\"${INSTALL_DIR}:\$PATH\""
    say ""
    say "Then run:"
    say "  better-jira"
    ;;
esac
