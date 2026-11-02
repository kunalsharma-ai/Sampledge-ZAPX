# 0005 · Containers locally, AWS (ECS/Fargate) in production

Date: 2026-11-01 · Status: Accepted

## Context

AWS is the preferred cloud. Milestone 1 must run locally without paid services; from Milestone 2
on, ZAPX should be ready for ECS/Fargate, RDS PostgreSQL, S3, ElastiCache/Valkey, SQS, CloudFront,
Secrets Manager/KMS, CloudWatch and OpenTelemetry, while staying portable.

## Decision

- One `Dockerfile`, four targets: `api`, `migrate` (one-off), `studio`, `runtime` (nginx serving
  the static runtime and proxying `/api`). `docker compose up --build` runs the whole stack with
  PostgreSQL. CI builds the images and boots the stack on every pull request.
- Target mapping on AWS:

| ZAPX                         | Local                  | AWS                                                                       |
| ---------------------------- | ---------------------- | ------------------------------------------------------------------------- |
| API, studio                  | containers             | ECS/Fargate services behind an ALB                                        |
| Migrations                   | `migrate` container    | ECS one-off task before each release                                      |
| Respondent runtime           | nginx container        | S3 + CloudFront, `/api/*` routed to the ALB                               |
| Database                     | postgres:16            | RDS PostgreSQL (Multi-AZ), RDS Proxy for pooling                          |
| Secrets                      | `.env`                 | Secrets Manager → task environment; `SecretBox` → KMS envelope encryption |
| Callback outbox, rate limits | PostgreSQL             | PostgreSQL first; SQS consumer / Valkey when volume requires              |
| Logs                         | stdout                 | CloudWatch Logs                                                           |
| Tracing                      | –                      | OpenTelemetry collector (ADOT) → X-Ray / CloudWatch                       |
| Uploads                      | in-memory (not stored) | S3 when files are kept                                                    |

- **Portability through seams, added when a consumer exists**: `SecretBox` (local AES-GCM today,
  KMS later), `CallbackWorker.runOnce()` (timer today, worker task or SQS consumer later),
  `RedirectService`, `AiProvider`. S3 is wired since Milestone 13 (ADR 0019); Valkey, SQS and OpenTelemetry are not, because no
  code needs them; adding unused infrastructure would only add cost and failure modes.

## Consequences

- Images are large (they carry the workspace `node_modules`); slimming with `pnpm deploy` is a
  follow-up once the deployment pipeline exists.
- The studio's `/api` rewrite target is fixed at image build time (`ZAPX_API_URL`); on AWS the ALB
  routes `/api` directly so the rewrite is unused.
- Infrastructure as code (Terraform or CDK) is the next step when the AWS account is ready.
