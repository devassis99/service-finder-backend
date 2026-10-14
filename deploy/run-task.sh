#!/bin/sh
#
# Run a one-off backend command against a deployed region — seeds, and
# anything else that is `pnpm <script>` on a laptop.
#
# There is no bastion and there does not need to be one. Aurora lives in
# private subnets with no public endpoint, and the only thing allowed to
# reach it is the app security group. A task launched into those subnets
# with that security group is already inside: it pulls the same image CI
# built, runs the same entrypoint, fetches the same secret, and talks to
# the database over the same verified TLS. A bastion would add an
# instance to patch, a key to lose and an open port, in exchange for
# nothing this does not already have.
#
#   sh deploy/run-task.sh seed:permissions
#   sh deploy/run-task.sh seed
#   sh deploy/run-task.sh dist/modules/auth/auth.seed.js
#
# It waits, reports the container's exit code, and prints the task's log
# either way — a seed that half-finishes is worth reading in full.
#
set -eu

usage() {
  echo "usage: sh deploy/run-task.sh [-e KEY=VALUE]... <script> [node args...]" >&2
  echo >&2
  echo "  -e  an environment variable for this run only. Some scripts read" >&2
  echo "      process.env directly because the value concerns the script and" >&2
  echo "      not the running app - SEED_SUPERADMIN_EMAIL is the one you will" >&2
  echo "      hit first. Those do not belong in the app secret." >&2
  echo >&2
  echo "scripts:" >&2
  for k in $ALIASES; do echo "  ${k%%=*}" >&2; done
  echo "  or any path inside the image, e.g. dist/modules/auth/auth.seed.js" >&2
  exit 64
}

# Mirrors package.json's db:seed* scripts. Kept here rather than derived
# so this file says plainly what it can run.
ALIASES="
seed=dist/modules/auth/auth.seed.js
seed:permissions=dist/modules/roles/bo-permissions.seed.js
"

# Env pairs go to a file rather than a shell string: one per line keeps a
# value containing spaces intact, which a word-split variable would not.
ENV_FILE=$(mktemp)
trap 'rm -f "$ENV_FILE"' EXIT INT TERM

while [ $# -gt 0 ]; do
  case "$1" in
    -e)
      [ $# -ge 2 ] || { echo "error: -e needs KEY=VALUE" >&2; usage; }
      printf '%s\n' "$2" >> "$ENV_FILE"
      shift 2
      ;;
    -e*) printf '%s\n' "${1#-e}" >> "$ENV_FILE"; shift ;;
    --)  shift; break ;;
    -*)  echo "error: unknown option $1" >&2; usage ;;
    *)   break ;;
  esac
done

# Rejected here rather than by RunTask, which reports a malformed override
# as a validation error naming neither the pair nor the reason.
while IFS= read -r pair; do
  case "$pair" in
    [A-Za-z_]*=*) ;;
    *) echo "error: -e wants KEY=VALUE, got: $pair" >&2; exit 64 ;;
  esac
done < "$ENV_FILE"

[ $# -ge 1 ] || usage
WANTED=$1
shift

SCRIPT=""
for pair in $ALIASES; do
  [ "${pair%%=*}" = "$WANTED" ] && SCRIPT="${pair#*=}" && break
done
# Not an alias: treat it as a path, but only one that looks like one, so
# a typo'd alias is a usage error rather than a task that starts and dies.
if [ -z "$SCRIPT" ]; then
  case "$WANTED" in
    dist/*.js) SCRIPT=$WANTED ;;
    *) echo "error: unknown script '$WANTED'" >&2; usage ;;
  esac
fi

: "${ECS_CLUSTER:=service-finder}"
: "${TASK_FAMILY:=service-finder-backend-migrate}"

# Plain `if`, not ${VAR:?message}: bash in POSIX mode — which is what
# /bin/sh is on macOS — reads an apostrophe inside ${...} as an opening
# quote and swallows the rest of the file looking for its pair, even
# though the whole expression is double-quoted. dash does not, so the
# broken form tests clean on Linux and mangles itself on a laptop.
missing=""
[ -n "${AWS_REGION:-}" ]     || missing="$missing AWS_REGION"
[ -n "${SUBNETS:-}" ]        || missing="$missing SUBNETS"
[ -n "${SECURITY_GROUP:-}" ] || missing="$missing SECURITY_GROUP"
if [ -n "$missing" ]; then
  echo "error: not set:$missing" >&2
  echo >&2
  echo "  export AWS_REGION=us-east-1" >&2
  echo "  export SUBNETS=\$(terraform -chdir=../service-finder-iac/envs/dev/us-east-1 output -json deploy_inputs | jq -r .subnets)" >&2
  echo "  export SECURITY_GROUP=\$(terraform -chdir=../service-finder-iac/envs/dev/us-east-1 output -json deploy_inputs | jq -r .security_group)" >&2
  exit 78
fi

# The container name inside TASK_FAMILY, which the override has to name.
CONTAINER=$(aws ecs describe-task-definition --region "$AWS_REGION" \
  --task-definition "$TASK_FAMILY" \
  --query 'taskDefinition.containerDefinitions[0].name' --output text)

echo "region     $AWS_REGION"
echo "cluster    $ECS_CLUSTER"
echo "task def   $TASK_FAMILY ($CONTAINER)"
echo "command    node $SCRIPT $*"
if [ -s "$ENV_FILE" ]; then
  # Names only. -e is for a value someone typed on a command line, and
  # this output tends to end up pasted into a chat window.
  echo "env        $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"
fi
echo

# The task definition's own image is used, which is whatever the last
# deploy registered — so a seed always runs the code that is serving.
OVERRIDES=$(CONTAINER="$CONTAINER" SCRIPT="$SCRIPT" ENV_FILE="$ENV_FILE" python3 -c '
import json, os, sys

override = {
    "name": os.environ["CONTAINER"],
    "command": ["node", os.environ["SCRIPT"], *sys.argv[1:]],
}

# The entrypoint writes .env from the secret and dotenv does not overwrite
# a variable already in the environment, so these win over the secret
# rather than being quietly ignored.
with open(os.environ["ENV_FILE"]) as fh:
    pairs = [line.rstrip("\n").split("=", 1) for line in fh if line.strip()]
if pairs:
    override["environment"] = [{"name": k, "value": v} for k, v in pairs]

print(json.dumps({"containerOverrides": [override]}))' "$@")

TASK=$(aws ecs run-task --region "$AWS_REGION" \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$TASK_FAMILY" \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SECURITY_GROUP],assignPublicIp=DISABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' --output text)

TASK_ID=${TASK##*/}
echo "task       $TASK_ID"
echo "waiting..."
aws ecs wait tasks-stopped --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK"

EXIT=$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].containers[0].exitCode' --output text)
REASON=$(aws ecs describe-tasks --region "$AWS_REGION" --cluster "$ECS_CLUSTER" --tasks "$TASK" \
  --query 'tasks[0].stoppedReason' --output text)

# Printed whether it worked or not. A seed that failed halfway is exactly
# when the output matters, and hunting for the stream name by hand is how
# that gets skipped.
LOG_GROUP=$(aws ecs describe-task-definition --region "$AWS_REGION" \
  --task-definition "$TASK_FAMILY" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-group"' --output text)
PREFIX=$(aws ecs describe-task-definition --region "$AWS_REGION" \
  --task-definition "$TASK_FAMILY" \
  --query 'taskDefinition.containerDefinitions[0].logConfiguration.options."awslogs-stream-prefix"' --output text)

echo
echo "--- $LOG_GROUP : $PREFIX/$CONTAINER/$TASK_ID"
aws logs get-log-events --region "$AWS_REGION" \
  --log-group-name "$LOG_GROUP" \
  --log-stream-name "$PREFIX/$CONTAINER/$TASK_ID" \
  --query 'events[].message' --output text 2>/dev/null || echo "(no log stream yet)"
echo "---"

if [ "$EXIT" != "0" ]; then
  echo "exited $EXIT ($REASON)" >&2
  exit 1
fi
echo "done."
