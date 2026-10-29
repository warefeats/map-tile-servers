#!/usr/bin/env bash
# Builds Berlin's tile files the way OpenFreeMap builds the planet's (github.com/hyperknot/openfreemap at 332669ab,
# tilegen/tilegen_lib/btrfs.py and mbtiles.py): every tile a gzip-encoded tiles/z/x/y.pbf as the archive stores it,
# identical tiles hard-linked to one file in a dedupl folder, metadata.json and osm_date beside them, extracted onto
# a Btrfs image made with single metadata and mounted with max_inline=4096, then copied without the dedupl folder
# onto a second such image, which is the one served. OpenFreeMap then shrinks it; a 1 GB image is kept as it is.
# Needs sudo (the mounts) and btrfs-progs.
#   scripts/lane-berlin-btrfs.sh <berlin.mbtiles> <out.btrfs>
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
src=$(realpath "$1")
out=$(realpath -m "$2")
work=$(mktemp -d)
cd "$work"

for image in image.btrfs image2.btrfs; do
  fallocate -l 1G "$image"
  mkfs.btrfs -q -m single "$image"
done
mkdir mnt_rw mnt_rw2
sudo mount -t btrfs -o noacl,nobarrier,noatime,max_inline=4096 image.btrfs mnt_rw
sudo mount -t btrfs -o noacl,nobarrier,noatime,max_inline=4096 image2.btrfs mnt_rw2
sudo chown -R "$(id -u):$(id -g)" mnt_rw mnt_rw2
python3 -I "$here/lane_extract_mbtiles.py" "$src" mnt_rw/extract
rsync -aH --exclude dedupl mnt_rw/extract/ mnt_rw2/
echo "$(find mnt_rw2/tiles -name '*.pbf' | wc -l) tile files"
sudo umount mnt_rw mnt_rw2
mv image2.btrfs "$out"
echo "$out: $(stat -c %s "$out") bytes"
