# The measurement client: sits on the engine's Docker network so no request crosses the host's
# port forwarder (which caps a 242 KB tile at ~13.8k/s on this rig). Bun runs the runner's own
# client scripts (bursts, map sessions, cold-start polling); oha is the same release as the host's.
FROM oven/bun:1.4.0-debian
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY oha /usr/local/bin/oha
ENTRYPOINT ["sleep", "infinity"]
