# Deploying service-finder-backend to ECS Fargate

The same shape as iGroom's backend: one image, several entry points, no
Kubernetes. The API runs as a long-lived service behind an ALB; migrations
run as a one-off task in the deploy pipeline; seeds run as one-off tasks
on demand. All of them are the same image, so they can never disagree about
the schema.

```
GitHub push ─┬─ check: typecheck, lint, test
             ├─ changes: which apps changed since what each service is running
             │
             └─ api lane       build APP=api → ECR (service-finder-backend)
                                 ├── run-task  node dist/db/migrate.js   (to completion, blocking)
                                 └── service   node dist/index.js        (ALB → :3000/health)
```

Files: `Dockerfile`, `.dockerignore`, `deploy/docker-entrypoint.sh`,
`deploy/ecs/task-definition.*.json`, `deploy/ecs/render.py`,
`deploy/changed-apps.mjs`, `deploy/run-task.sh`,
`.github/workflows/deploy.yml`.

None of the AWS resources below exist yet for Service Finder. The quickest
route is a copy of iGroom's infrastructure repository with the names
changed — every name the pipeline expects is listed in
[Names](#names) — or the commands in this file, by hand.

## How the environment reaches the app

The application reads `.env` through dotenv and knows nothing about AWS.
`deploy/docker-entrypoint.sh` is what closes the gap: on start it reads
`SECRETS_MANAGER_SECRET_ID`, fetches that secret with the task role's own
credentials, writes `/app/.env`, and then `exec`s the command it was given.

```
container start
  └─ docker-entrypoint.sh
       ├─ aws secretsmanager get-secret-value  →  /app/.env  (mode 600)
       └─ exec node dist/index.js              →  dotenv reads it, as on a laptop
```

- **The secret is the only place a variable is named.** Adding a key to the
  secret is the whole change — no task definition edit, no new revision,
  just a restart.
- **Nothing is fetched at build time**, so no secret is ever written into an
  image layer in ECR. The file exists only inside the running task and dies
  with it.
- **Values are read once, at start.** A rotated secret reaches a task on its
  next restart, not sooner.
- **The task definition wins over the secret.** dotenv never overwrites a
  variable that is already in the environment, so anything in the task
  definition's `environment` block — `PORT`, `TZ`, `CORS_ORIGINS` — takes
  precedence over a key of the same name in the secret.

**One constraint on the secret's contents:** dotenv is not a shell. Its
parser strips surrounding quotes but unescapes nothing, so a value containing
a single quote (`'`) cannot be represented in a `.env` file at all. The
entrypoint quotes every value safely and refuses to start, naming the key, if
a value contains a single quote — a container that won't boot and says why
beats a silently truncated `DATABASE_URL`.

## Names

| What                         | Name                                                            |
| ---------------------------- | --------------------------------------------------------------- |
| ECS cluster                  | `service-finder`                                                |
| ECS service                  | `service-finder-backend-api`                                    |
| Task definition families     | `service-finder-backend-api`, `service-finder-backend-migrate`  |
| ECR repository               | `service-finder-backend`                                        |
| Secret                       | `service-finder/backend`                                        |
| Log group                    | `/ecs/service-finder-backend`                                   |
| Task execution role          | `serviceFinderEcsTaskExecutionRole`                             |
| Task role                    | `serviceFinderBackendTaskRole`                                  |
| GitHub deploy role (OIDC)    | `serviceFinderGithubDeployRole`                                 |
| Repository secrets           | `AWS_ACCOUNT_ID`, `PRIVATE_SUBNET_IDS`, `APP_SECURITY_GROUP_ID` |
| GitHub Environment variables | `CORS_ORIGINS` (environment `production`)                       |

`deploy/ecs/*.json` are templates: `render.py` fills `<ACCOUNT_ID>`,
`<REGION>` and `<CORS_ORIGINS>` from the workflow's environment and fails the
job, before anything is built, if any of them is unset or empty.

## What must exist

### 1. The secret

This one secret is the app's entire environment. `apps/api/src/config/env.ts`
fails at boot — not at first use — if any of these is missing, so the task
will crash-loop rather than start degraded: `DATABASE_URL`,
`GOOGLE_CLIENT_ID`, `JWT_SECRET`, `MFA_ENCRYPTION_KEY`, `STRIPE_SECRET_KEY`.

```bash
aws secretsmanager create-secret --name service-finder/backend --secret-string '{
  "DATABASE_URL": "postgres://service_finder:...@service-finder.cluster-xxxx.'"$REGION"'.rds.amazonaws.com:5432/service_finder",
  "DIRECT_DATABASE_URL": "postgres://service_finder:...@service-finder.cluster-xxxx.'"$REGION"'.rds.amazonaws.com:5432/service_finder",
  "JWT_SECRET": "'"$(openssl rand -hex 32)"'",
  "MFA_ENCRYPTION_KEY": "'"$(openssl rand -hex 32)"'",
  "GOOGLE_CLIENT_ID": "...apps.googleusercontent.com",
  "STRIPE_SECRET_KEY": "sk_live_...",
  "TENANT_APP_URL": "https://<tenant-app-domain>",
  "TRUST_PROXY_HOPS": "1",
  "REDIS_URL": "rediss://<elasticache-endpoint>:6379",
  "RESEND_API_KEY": "re_..."
}'
```

`DIRECT_DATABASE_URL` is the same string as `DATABASE_URL` today. It exists
so that the day PgBouncer goes in front of Postgres, `DATABASE_URL` moves to
the pooler and migrations keep their direct connection. Set both now and that
change is one secret edit rather than a code change.

`TRUST_PROXY_HOPS` is required in production — `app.ts` refuses to start
without it — because per-device rate limits key on the caller's address: 1
behind the ALB alone, 2 with CloudFront in front.

`TENANT_APP_URL` is the business app's address, and every link this API hands
out into it is built on it: staff invites (`<TENANT_APP_URL>/invite#<token>`)
and the Plans page's "Copy" signup links (`<TENANT_APP_URL>/join/<token>`).
Unset, it falls back to the local dev server, `http://localhost:5274`, which is
wrong for any deployed environment — invite emails would point at localhost.
Signup links are rebuilt from their token on every read, so changing it later
moves every one already handed out along with it; an invite already emailed
keeps the address it was sent with.

`CORS_ORIGINS` has to list the business app's origin as well as the back
office's, or its browser calls are refused.

Use a test-mode `STRIPE_SECRET_KEY` (`sk_test_...`) for any environment that
isn't taking real payments.

Generate `JWT_SECRET` and `MFA_ENCRYPTION_KEY` once, here, and keep them
different from iGroom's. Rotating the first later signs everyone out; rotating
the second makes every stored TOTP secret undecryptable.

### 2. Postgres and Valkey

RDS or Aurora Serverless v2 in the same VPC, **not** in the cluster, with its
own security group accepting 5432 only from the app security group. Every
table lives in the `service_finder` Postgres schema, not `public` (see
`packages/db/src/schema/_schema.ts`); the first migration creates it, so
nothing needs creating by hand.

ElastiCache Serverless for Valkey for `REDIS_URL` (`REDIS_CLUSTER=true` is
already in the task definition). Without it the API still runs, with sign-in
attempt limits failing open and a warning at boot.

### 3. Two IAM roles

- **`serviceFinderEcsTaskExecutionRole`** — what ECS itself uses to pull the
  image and write logs. `AmazonECSTaskExecutionRolePolicy` is all it needs.
- **`serviceFinderBackendTaskRole`** — the credentials the running container
  gets, and therefore what the entrypoint uses. This is the role that needs
  `secretsmanager:GetSecretValue` on the secret above.

Getting these two the wrong way round is the most likely first-deploy
failure: the container starts, prints `entrypoint: could not read
service-finder/backend`, and exits 1.

### 4. ECR, the cluster, the log group

```bash
aws ecr create-repository --repository-name service-finder-backend \
  --image-scanning-configuration scanOnPush=true
aws ecs create-cluster --cluster-name service-finder
aws logs create-log-group --log-group-name /ecs/service-finder-backend
aws logs put-retention-policy --log-group-name /ecs/service-finder-backend --retention-in-days 30
```

### 5. The service, behind an ALB

Target group: **target type `ip`** (Fargate uses awsvpc networking), port
3000, health check path `/health`, and a deregistration delay of 30 seconds to
match the container's `stopTimeout` — `apps/api/src/index.ts` drains in-flight
requests and closes the Postgres pools on SIGTERM.

```bash
aws ecs register-task-definition --cli-input-json file://deploy/ecs/task-definition.api.json

aws ecs create-service \
  --cluster service-finder --service-name service-finder-backend-api \
  --task-definition service-finder-backend-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --health-check-grace-period-seconds 60 \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-a,subnet-b],securityGroups=[sg-app],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=<TARGET_GROUP_ARN>,containerName=api,containerPort=3000" \
  --deployment-configuration "minimumHealthyPercent=100,maximumPercent=200"
```

`desired-count 2` across two availability zones is what makes a deploy
zero-downtime. `/health` answers without touching the database, so a task
with a broken `DATABASE_URL` still passes it — the first real request is what
fails. Watch the logs of a first deploy rather than trusting a green target.

## GitHub Actions

The workflow authenticates with OIDC, so there are no AWS keys in the
repository. Create `serviceFinderGithubDeployRole` trusting
`token.actions.githubusercontent.com` with a subject condition on this repo,
and give it: ECR push, `ecs:RegisterTaskDefinition`,
`ecs:DescribeTaskDefinition`, `ecs:RunTask`, `ecs:DescribeTasks`,
`ecs:UpdateService`, `ecs:DescribeServices`, and `iam:PassRole` for the two
task roles.

| Job         | Does                                                                                                      |
| ----------- | --------------------------------------------------------------------------------------------------------- |
| **check**   | typecheck, lint and test, once for the whole workspace                                                    |
| **changes** | works out which apps this run deploys (below)                                                             |
| **API**     | build → run the migration task and **wait for its exit code** → update the service and wait for stability |

The API lane needs `check`, so nothing deploys from a red commit. A failed
migration stops the lane with the service untouched.

### Which apps a run deploys

`changes` reads the image tag of the task definition each service is running —
every image is tagged with the commit it was built from — and
`deploy/changed-apps.mjs` compares that commit with the one being pushed. An
app deploys when anything it is built from changed: its own folder, any
workspace package it depends on (followed through `workspace:` dependencies,
so a new package is picked up without editing the script), its task
definitions, or a file every image is built from (`Dockerfile`, the lockfile,
`package.json`, the entrypoint, the workflow). A tag that is not a commit —
`latest` on a service that was only just created — counts as changed.

```sh
node deploy/changed-apps.mjs origin/main   # what would deploy, against main
```

A manual run (**Actions → Deploy backend → Run workflow**) can pick `all`
(the default), `changed` or `api`.

## Seeds against a deployed region

Aurora has no public endpoint, so `pnpm db:seed` from a laptop cannot connect.
A one-off ECS task launched into the same private subnets _is_ inside,
running the same image, entrypoint, secret and verified TLS as the API:

```bash
export AWS_REGION=us-east-1 SUBNETS=subnet-a,subnet-b SECURITY_GROUP=sg-app

sh deploy/run-task.sh -e SEED_SUPERADMIN_EMAIL=you@example.com seed
sh deploy/run-task.sh seed:permissions
sh deploy/run-task.sh seed:billing     # optional — placeholder plans, created in Stripe
```

Same order as locally — the permissions seed grants everything to the
`superadmin` role that `seed` creates. `seed:billing` creates real Stripe
Products and Prices with whichever key the secret holds, so read its `CATALOG`
first; plans can equally be created from the Plans page. The script waits for the task, prints
its log whether it passed or failed, and exits non-zero if the container did.
`-e` sets a variable for that one run, which is where `SEED_SUPERADMIN_EMAIL`
belongs: it concerns the script, not the running app.

## Rollback

```bash
aws ecs update-service --cluster service-finder --service service-finder-backend-api \
  --task-definition service-finder-backend-api:<PREVIOUS_REVISION> --force-new-deployment
```

This rolls back the code, not the schema. Drizzle migrations have no down
step, so keep migrations additive (add a column, backfill, switch reads, drop
it in a later release) rather than rewriting a table in one go.

## Running the image locally

With `SECRETS_MANAGER_SECRET_ID` unset the entrypoint does nothing and the
container uses the environment as given:

```bash
docker build -t service-finder-backend .
docker compose up -d
docker run --rm -p 3000:3000 --env-file apps/api/.env -e PORT=3000 \
  -e DATABASE_URL='postgres://user:password@host.docker.internal:5433/service_finder' \
  -e REDIS_URL='redis://host.docker.internal:6380' \
  service-finder-backend
curl localhost:3000/health   # {"status":"ok"}
```

Migrations against the same database:

```bash
docker run --rm --env-file apps/api/.env \
  -e DIRECT_DATABASE_URL='postgres://user:password@host.docker.internal:5433/service_finder' \
  service-finder-backend node dist/db/migrate.js
```

**The root filesystem is not read-only**, because the entrypoint writes
`/app/.env` into it. To get that hardening back, mount an ephemeral volume and
point `ENV_FILE` (where the entrypoint writes) and `DOTENV_CONFIG_PATH` (where
dotenv reads) at it — no application change needed.
