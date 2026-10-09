#!/usr/bin/env bash
# Martin from source with its own release recipe (docs/adr/0003, 0006), on an Ubuntu 24.04 arm64 host such as
# the OrbStack machine:  orb -m martin-linux bash scripts/build-martin.sh <commit> <rustc> <build context>
# Then, on the Mac:      docker build --platform linux/arm64 -t wf-martin:<version>-<short commit> <build context>
set -euo pipefail
SHA=${1:?commit}
TOOLCHAIN=${2:?rustc the latest official 2.0 binary reports, e.g. 1.99.0}
CONTEXT=${3:?docker build context}
SRC=$HOME/m2-src-${SHA:0:8}
rm -rf "$SRC" && mkdir -p "$SRC" && cd "$SRC"
git init -q && git fetch -q --depth 1 https://github.com/maplibre/martin "$SHA" && git checkout -q FETCH_HEAD
# Martin's `just build-release` for one target.
export CARGO_TARGET_DIR=$HOME/target-rel-${SHA:0:8}
export CARGO_TARGET_AARCH64_UNKNOWN_LINUX_GNU_RUSTFLAGS="-C strip=symbols"
cargo +"$TOOLCHAIN" build --release --target aarch64-unknown-linux-gnu --package martin --locked
mkdir -p "$CONTEXT/target_releases/linux/arm64"
cp "$CARGO_TARGET_DIR/aarch64-unknown-linux-gnu/release/martin" "$CONTEXT/target_releases/linux/arm64/martin"
# The commit's own Dockerfile. Docker Hub refuses this Mac's saved login, and ECR Public mirrors the same digest.
sed 's#^FROM ubuntu:24.04@#FROM public.ecr.aws/docker/library/ubuntu@#' .github/files/multi-platform.Dockerfile > "$CONTEXT/Dockerfile"
readelf -p .comment "$CONTEXT/target_releases/linux/arm64/martin" | grep rustc
