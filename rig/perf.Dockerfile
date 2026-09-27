FROM debian:trixie-slim
RUN apt-get update && apt-get install -y --no-install-recommends linux-perf procps && rm -rf /var/lib/apt/lists/*
ENTRYPOINT ["sleep", "infinity"]
