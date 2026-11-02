# ZAPX on AWS (Terraform)

One stack per environment (staging, production) in one AWS account and region. Status: the code
passes `terraform validate` and plan tests against a mocked AWS provider (`tests/plan.tftest.hcl`,
run by `pnpm check` when Terraform is installed). **It has not been applied to an AWS account yet.**
Apply it to a staging account first and expect to adjust details there.

## What it creates

```
             respondents / interviewers                     research teams
                        │                                         │
        take.… / field.…│ (CloudFront + ACM us-east-1)    zapx.…  │
                        ▼                                         ▼
     ┌──────────── CloudFront ────────────┐               ┌──── ALB (443, ACM) ────┐
     │ static runtime and CAPI app (S3)   │  /api/* with  │ /api/* → API           │
     │ /api/*  ──────────────────────────────X-Zapx-Edge─▶│ the rest → studio      │
     └────────────────────────────────────┘               └──────────┬─────────────┘
                                                                     │ private subnets
                       ┌──────────────┬───────────────┬──────────────┴──┐
                       │ API (Fargate)│ worker        │ studio          │
                       └──────┬───────┴──────┬────────┴─────────────────┘
                              │              │
               RDS PostgreSQL 16 (Multi-AZ)  S3 files bucket (SSE-KMS)
```

| Part             | Resources                                                                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Network          | VPC over 2 zones, public and private subnets, NAT (one shared, or one per zone), S3 gateway endpoint                                        |
| Compute          | ECS cluster; services `api` (2), `worker` (1), `studio` (2); task `migrate`; ECR repos `api`, `studio`                                      |
| Database         | RDS PostgreSQL 16, encrypted, Multi-AZ, managed master password, `rds.force_ssl`, 14-day backups, deletion protection, Performance Insights |
| Files            | Private bucket, SSE-KMS, versioning (old versions expire after 30 days), TLS-only policy                                                    |
| Static apps      | Two private buckets behind CloudFront with origin access control and an SPA rewrite function                                                |
| Edge             | ALB with HTTP→HTTPS, TLS 1.3 policy; CloudFront with security headers, `/api/*` uncached to the ALB                                         |
| Secrets and keys | One KMS key (rotation on) for data, logs, secrets and images; Secrets Manager secret `zapx-<env>/app`                                       |
| Observability    | CloudWatch log groups (30 days, encrypted), Container Insights, alarms (API 5xx, unhealthy tasks, DB CPU, DB storage) to an SNS topic       |

## Before the first apply

1. **Certificates (ACM):** one in your region for `studio_domain` and `api_origin_domain`, one in
   `us-east-1` for `runtime_domain` and `capi_domain`. Validate them with DNS.
2. **State backend:** an S3 bucket for Terraform state. Create `backend.hcl` (git-ignored):
   `bucket = "..."`, `key = "zapx/staging.tfstate"`, `region = "eu-west-1"`, `use_lockfile = true`.
   The state contains `edge_shared_secret`; restrict who can read the bucket.
3. **Variables:** copy `example.tfvars` to `staging.tfvars` (git-ignored) and fill it in. Pass the
   edge secret on the command line or as `TF_VAR_edge_shared_secret` (`openssl rand -hex 32`).

```bash
cd infra/terraform
terraform init -backend-config=backend.hcl
terraform apply -var-file=staging.tfvars
```

4. **App secret:** put the secret values in Secrets Manager (Terraform never holds them):

```bash
aws secretsmanager put-secret-value --secret-id "$(terraform output -raw app_secret_arn)" --secret-string '{
  "JWT_SECRET": "<openssl rand -hex 32>",
  "SECRETS_KEY": "<openssl rand -base64 32>",
  "EDGE_SHARED_SECRET": "<the same value as edge_shared_secret>",
  "ANTHROPIC_API_KEY": "",
  "STRIPE_SECRET_KEY": "",
  "STRIPE_WEBHOOK_SECRET": ""
}'
```

Keep `SECRETS_KEY` safe: it decrypts stored vendor secrets, SSO client secrets and phone numbers.
Every key named in `app_secret_keys` must exist in the JSON (empty is fine), or the tasks fail
to start.

5. **DNS:** point `studio_domain` and `api_origin_domain` at `load_balancer_dns`, and
   `runtime_domain` / `capi_domain` at the `cloudfront_domains` outputs.

## Releasing

```bash
ENVIRONMENT=staging infra/scripts/deploy-aws.sh
```

builds and pushes the images tagged with the git commit, runs the migration task with the new image
and stops if it fails, rolls out the services (ECS rolls back by itself if the new tasks fail their
health checks), then publishes the runtime and CAPI app to S3 and refreshes CloudFront.

## Settings worth knowing

- Non-secret ZAPX settings go in `app_environment` (see `.env.example`), e.g. `AI_MODEL`,
  `BILLING = "stripe"`, `STRIPE_PRICES`, `DEFAULT_PLAN`. The stack already sets the addresses, the
  database parts, `FILE_STORE=s3`, the CloudFront headers and production flags.
- Sign-up is off (`ALLOW_SIGNUP=false`); create the first organization with a temporary
  `ALLOW_SIGNUP = "true"` in `app_environment`, then remove it.
- `nat_gateway_per_az = true` survives a zone outage for outbound calls at the cost of a second NAT.
- `db_multi_az = false` is fine for staging.

## Costs (rough, eu-west-1, before traffic)

NAT gateway(s), the ALB, RDS (`db.t4g.medium` Multi-AZ) and five small Fargate tasks are the fixed
costs; together roughly USD 250–400 a month for production and about half for a staging stack with
a single-AZ database. CloudFront, S3 and logs grow with use.

## Not included yet

WAF rules, AWS Backup plans beyond RDS automated backups, a bastion or Session Manager access to the
database, autoscaling policies, and Valkey or SQS (not needed at the current volume, ADR 0005).
