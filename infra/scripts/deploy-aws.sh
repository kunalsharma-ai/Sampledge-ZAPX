#!/usr/bin/env bash
# Release ZAPX to an AWS environment created by infra/terraform (Milestone 13).
#
#   ENVIRONMENT=production infra/scripts/deploy-aws.sh [image-tag]
#
# Steps: build and push the api and studio images, point the migration task at the new image and run
# it (the release stops if it fails), roll out the services, then publish the respondent runtime and
# the CAPI app to their S3 buckets and refresh CloudFront.
#
# Needs: docker, the AWS CLI v2 signed in to the account, terraform (initialised in infra/terraform
# with this environment's backend), pnpm, jq. The image tag defaults to the current git commit, and
# the working tree must be clean so the tag describes what is deployed.
#
# NOT YET RUN AGAINST AWS: written with the Terraform in infra/terraform, which passes
# `terraform validate`, but no AWS account was available while it was built. Run it on staging first.
set -euo pipefail
: "${ENVIRONMENT:?set ENVIRONMENT (staging or production)}"
cd "$(dirname "$0")/../.."
TF="terraform -chdir=infra/terraform"
VARS=(-var-file="${ENVIRONMENT}.tfvars")

if [[ -n "$(git status --porcelain)" ]]; then
  echo "The working tree has changes; commit them first so the image tag means something." >&2
  exit 1
fi
TAG="${1:-$(git rev-parse --short=12 HEAD)}"
out() { $TF output -json | jq -r "$1"; }

REGION="$(out '.ecr_repositories.value.api' | cut -d. -f4)"
REGISTRY="$(out '.ecr_repositories.value.api' | cut -d/ -f1)"
API_REPO="$(out '.ecr_repositories.value.api')"
STUDIO_REPO="$(out '.ecr_repositories.value.studio')"

echo "==> Building images $TAG"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"
docker build --target api -t "$API_REPO:$TAG" .
# On AWS the load balancer sends /api straight to the API, so the studio's build-time rewrite is unused.
docker build --target studio -t "$STUDIO_REPO:$TAG" .
docker push "$API_REPO:$TAG"
docker push "$STUDIO_REPO:$TAG"

echo "==> Database migrations"
$TF apply -input=false -auto-approve "${VARS[@]}" -var "image_tag=$TAG" -target=aws_ecs_task_definition.migrate
CLUSTER="$(out '.cluster.value')"
FAMILY="$(out '.migrate_task.value.family')"
SUBNETS="$(out '.migrate_task.value.subnets | join(",")')"
SGS="$(out '.migrate_task.value.security_groups | join(",")')"
TASK="$(aws ecs run-task --region "$REGION" --cluster "$CLUSTER" --task-definition "$FAMILY" --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SGS],assignPublicIp=DISABLED}" \
  --query 'tasks[0].taskArn' --output text)"
aws ecs wait tasks-stopped --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK"
CODE="$(aws ecs describe-tasks --region "$REGION" --cluster "$CLUSTER" --tasks "$TASK" --query 'tasks[0].containers[0].exitCode' --output text)"
if [[ "$CODE" != "0" ]]; then
  echo "Migrations failed (exit $CODE); the services were not changed. See the /zapx/$ENVIRONMENT/migrate logs." >&2
  exit 1
fi

echo "==> Rolling out the API, worker and studio"
$TF apply -input=false -auto-approve "${VARS[@]}" -var "image_tag=$TAG"
aws ecs wait services-stable --region "$REGION" --cluster "$CLUSTER" --services api worker studio

echo "==> Publishing the respondent runtime and the CAPI app"
pnpm install --frozen-lockfile
pnpm --filter @zapx/runtime --filter @zapx/capi... build
for site in runtime capi; do
  BUCKET="$(out ".static_buckets.value.$site")"
  DIST="apps/$site/dist"
  # Hashed assets are cached for a year; the entry files are revalidated on every visit.
  aws s3 sync "$DIST/assets" "s3://$BUCKET/assets" --cache-control "public, max-age=31536000, immutable"
  aws s3 sync "$DIST" "s3://$BUCKET" --exclude "assets/*" --cache-control "no-cache" --delete
  aws cloudfront create-invalidation --distribution-id "$(out ".cloudfront_distribution_ids.value.$site")" \
    --paths "/index.html" "/sw.js" "/manifest.webmanifest" >/dev/null
done

echo "==> Released $TAG to $ENVIRONMENT"
