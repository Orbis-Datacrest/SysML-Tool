#!/usr/bin/env sh
set -eu
rm -rf .data
docker compose -f infra/docker-compose.yml down -v
