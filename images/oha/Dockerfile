# The load generator as a container, for runs where the client sits on the engine's Docker
# network instead of reaching it through the host's published port. Same oha release as the host.
FROM debian:bookworm-slim
COPY oha /usr/local/bin/oha
ENTRYPOINT ["/usr/local/bin/oha"]
