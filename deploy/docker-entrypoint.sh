#!/bin/sh
#
# Writes .env from AWS Secrets Manager, then starts whatever it was asked
# to start.
#
# The application is not involved. src/config/env.ts already loads .env
# through dotenv on its first import, so putting the file in place before
# node runs is enough — no SDK, no bootstrap module, no change to how the
# app reads its configuration here or locally.
#
# Nothing is fetched at build time, so no secret is ever written into an
# image layer. The file is created inside the running task from the task
# role's own credentials, and dies with the container.
#
set -eu

: "${SECRETS_MANAGER_SECRET_ID:=}"
ENV_FILE="${ENV_FILE:-/app/.env}"

# dotenv is not a shell. Its parser (see the LINE regex in dotenv's
# main.js) strips surrounding quotes but performs no unescaping: a
# backslash-escaped quote inside a value survives into the value as a
# literal backslash. So there is exactly one safe encoding — wrap every
# value in single quotes, which passes ", $, `, #, backslashes and even
# newlines through untouched — and exactly one value that cannot be
# encoded at all: one containing a single quote.
#
# That case is refused by name rather than written out wrong. A silently
# truncated DATABASE_URL is a bad afternoon; a container that will not
# start and says which key is at fault is ten seconds.
#
# The filter writes the quote as \u0027 so that the jq program itself
# contains no single quote, and can therefore sit inside shell single
# quotes without the usual unreadable escaping dance.
JQ_TO_DOTENV='
  def q: "\u0027";
  to_entries
  | map(select(.value != null))
  | map(.value |= tostring)
  | map(
      if (.key | test("^[A-Za-z_][A-Za-z0-9_]*$") | not)
      then error("\(.key) is not a usable environment variable name")
      elif (.value | contains(q))
      then error("the value of \(.key) contains a single quote, which a .env file cannot escape")
      else . end
    )
  | map("\(.key)=" + q + .value + q)
  | .[]
'

if [ -n "$SECRETS_MANAGER_SECRET_ID" ]; then
  echo "entrypoint: fetching $SECRETS_MANAGER_SECRET_ID"

  SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRETS_MANAGER_SECRET_ID" \
    --query SecretString --output text) || {
      echo "entrypoint: could not read $SECRETS_MANAGER_SECRET_ID." >&2
      echo "  The ECS *task* role (not the execution role) needs secretsmanager:GetSecretValue on it," >&2
      echo "  and AWS_REGION must be set on the task." >&2
      exit 1
    }

  # Written to a temporary file first: a half-written .env left behind by
  # a failing jq is worse than none, because dotenv would load it and the
  # app would fail somewhere further along with a confusing message.
  TMP_ENV="${ENV_FILE}.tmp"
  printf '%s' "$SECRET_JSON" | jq -er "$JQ_TO_DOTENV" > "$TMP_ENV" || {
      rm -f "$TMP_ENV"
      echo "entrypoint: $SECRETS_MANAGER_SECRET_ID is not a flat JSON object of environment variables," >&2
      echo "  or one of its entries cannot be written to a .env file (see the error above)." >&2
      exit 1
    }

  mv "$TMP_ENV" "$ENV_FILE"
  chmod 600 "$ENV_FILE"

  # Key names only, and only the ones actually written — a null entry is
  # skipped above, and logging it would have somebody hunting for a
  # variable the app never received. A value has never belonged in a log
  # line at all.
  KEYS=$(printf '%s' "$SECRET_JSON" |
    jq -r '[to_entries[] | select(.value != null) | .key] | join(" ")')
  echo "entrypoint: wrote $ENV_FILE — $KEYS"

  # An unfilled value is worse than a missing one. terraform seeds this
  # secret with REPLACE_ME for exactly the variables config/env.ts refuses
  # to start without, so a region that was stood up but never configured
  # would otherwise fail several seconds later inside zod, in a task that
  # ECS then restarts on a loop — the same message every time, none of it
  # saying which secret to go and edit. Say it here instead, once, with
  # the name of the secret and the keys still holding placeholders.
  UNFILLED=$(sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*REPLACE_ME.*/\1/p' "$ENV_FILE" | tr '\n' ' ')
  if [ -n "$UNFILLED" ]; then
    echo "entrypoint: $SECRETS_MANAGER_SECRET_ID still holds terraform's placeholders: $UNFILLED" >&2
    echo "  Fill it before deploying this region:" >&2
    echo "    aws secretsmanager put-secret-value --region \"\$AWS_REGION\" \\" >&2
    echo "      --secret-id $SECRETS_MANAGER_SECRET_ID --secret-string '{\"KEY\":\"value\", ...}'" >&2
    exit 1
  fi
else
  # No secret configured: local runs, and `docker run --env-file .env`,
  # behave exactly as they did before this script existed.
  echo "entrypoint: SECRETS_MANAGER_SECRET_ID unset — using the environment as given"
fi

# exec, so node becomes PID 1 and receives SIGTERM directly. Without it
# this shell holds PID 1, swallows the signal, and the graceful shutdown
# in src/index.ts — drain in-flight requests, close the Postgres pools —
# never runs; ECS would SIGKILL the task 30 seconds later instead.
exec "$@"
