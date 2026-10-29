#!/usr/bin/env bash
# Martin from source the way its release builds the arm64 Docker binary (docs/adr/0010): Martin's own
# `just build-release aarch64-unknown-linux-gnu true`, a profile-guided build trained by the recipe's
# `just bench-http` against the test fixtures and a PostGIS loaded by tests/fixtures/initdb.sh, as
# build-binary.yml runs it on ubuntu-24.04-arm. Then the commit's own Dockerfile packages the binaries.
#   build-martin-pgo.sh <commit> <rustc> <image tag> [<work dir>]
# Runs as root on an Ubuntu 24.04 arm64 host with Docker; installs its own toolchain. oha (the release
# build-binary.yml installs, 1.16.0) must be on PATH for the training run.
set -euo pipefail
SHA=${1:?commit}
TOOLCHAIN=${2:?rustc the latest official 2.0 binary reports, e.g. 1.99.1}
TAG=${3:?image tag}
WORK=${4:-/opt/martin-build}
TARGET=aarch64-unknown-linux-gnu
# The service container build-binary.yml profiles against, pinned there by digest.
PGO_DB_IMAGE=ghcr.io/baosystems/postgis:18-3.6@sha256:8784f86b3e0e046859c96ea25eb8b10f0b801fd891b99a82b82f28ac4a643db8
PGO_DB=m2-pgo-db

export HOME=${HOME:-/root}
export CARGO_HOME=$HOME/.cargo RUSTUP_HOME=$HOME/.rustup
export PATH=$CARGO_HOME/bin:/usr/local/node/bin:$PATH
export DEBIAN_FRONTEND=noninteractive

command -v oha >/dev/null || { echo "oha is not on PATH" >&2; exit 1; }
echo "build: $SHA with rustc $TOOLCHAIN as $TAG ($(oha --version))"

# The toolchain the runner image brings: a C toolchain for the -sys crates, and npm for the webui feature.
# apt waits for a held lock instead of failing, here and in the recipe's own `sudo apt-get` calls.
echo 'DPkg::Lock::Timeout "900";' > /etc/apt/apt.conf.d/99-wait-for-lock
apt-get install -y --no-install-recommends build-essential pkg-config cmake clang perl git curl xz-utils >/dev/null
if ! command -v rustup >/dev/null; then
  curl --proto '=https' --tlsv1.2 -fsSL https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain "$TOOLCHAIN" >/dev/null
fi
rustup toolchain install "$TOOLCHAIN" --profile minimal >/dev/null
rustup default "$TOOLCHAIN"
if ! command -v npm >/dev/null; then
  node=$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt | awk '/linux-arm64\.tar\.xz$/ { print $2 }')
  mkdir -p /usr/local/node
  curl -fsSL "https://nodejs.org/dist/latest-v22.x/$node" | tar -xJ -C /usr/local/node --strip-components=1
fi
command -v just >/dev/null || cargo install just --locked --quiet
rustc -vV
echo "node $(node --version), npm $(npm --version), $(just --version)"

rm -rf "$WORK" && mkdir -p "$WORK" && cd "$WORK"
git init -q && git fetch -q --depth 1 https://github.com/maplibre/martin "$SHA" && git checkout -q FETCH_HEAD
git log -1 --format='commit %H %cd %s'

# build-binary.yml: `just pgo-install`, then the profiling database, then `just build-release <target> true`.
just pgo-install "$TARGET"
docker rm -f "$PGO_DB" >/dev/null 2>&1 || true
docker run -d --name "$PGO_DB" -p 127.0.0.1:5432:5432 -e POSTGRES_DB=test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres "$PGO_DB_IMAGE" >/dev/null
trap 'docker rm -f "$PGO_DB" >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 60); do docker exec "$PGO_DB" pg_isready -U postgres -d test >/dev/null 2>&1 && break; sleep 2; done
PGHOST=localhost PGPORT=5432 PGUSER=postgres PGPASSWORD=postgres PGDATABASE=test tests/fixtures/initdb.sh >/dev/null
DATABASE_URL=postgres://postgres:postgres@localhost:5432/test just build-release "$TARGET" true
docker rm -f "$PGO_DB" >/dev/null
trap - EXIT

# The release workflow downloads that job's artifact into target_releases/linux/arm64/ and builds the
# commit's multi-platform.Dockerfile; a small context keeps the build tree out of the image build.
ctx=$WORK/image
mkdir -p "$ctx/target_releases/linux/arm64"
cp target_releases/martin target_releases/mbtiles "$ctx/target_releases/linux/arm64/"
cp .github/files/multi-platform.Dockerfile "$ctx/Dockerfile"
docker build -q --platform linux/arm64 --build-arg TARGETPLATFORM=linux/arm64 -t "$TAG" "$ctx"

# What the page names as the measured build.
bin=$ctx/target_releases/linux/arm64/martin
{
  echo "commit $SHA"
  echo "image $TAG $(docker image inspect -f '{{.Id}}' "$TAG")"
  echo "version $(docker run --rm --entrypoint /usr/local/bin/martin "$TAG" --version)"
  echo "binary sha256 $(sha256sum "$bin" | cut -d' ' -f1), $(stat -c %s "$bin") bytes"
  readelf -p .comment "$bin" | grep -E 'rustc|GCC'
  echo "trained with $(oha --version), cargo-pgo $(cargo pgo --version 2>/dev/null || echo 0.3.0)"
  tail -n 5 "target/pgo-training.log" 2>/dev/null || true
} | tee "$WORK/build-info.txt"
