#!/usr/bin/env sh
set -eu
docker compose -f infra/docker-compose.yml up --build
