/** What every script the archive lane renders for an instance starts with, and how it quotes. */
export const READY_MARKER = "/var/lib/martin-2-bench-ready";

export const q = (s: string) => `'${s.replaceAll("'", `'"'"'`)}'`;

/** A bash script's first lines: a full PATH (SSM gives a minimal one), strict mode, and what it is. */
export const scriptHead = (what: string) => ["#!/usr/bin/env bash", "export PATH=/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin", "set -euo pipefail", `echo ${q(what)}`];

/** Waits for the user data's ready marker: SSM answers before user data has installed the AWS CLI. */
export const waitReady = [`for _ in $(seq 1 240); do [ -e ${READY_MARKER} ] && break; sleep 5; done`, `[ -e ${READY_MARKER} ] || { echo 'user data never finished'; exit 1; }`];
