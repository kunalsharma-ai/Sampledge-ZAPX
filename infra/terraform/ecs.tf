# ---- Images ------------------------------------------------------------------------------------
resource "aws_ecr_repository" "app" {
  for_each             = toset(["api", "studio"])
  name                 = "${local.name}-${each.key}"
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration {
    encryption_type = "KMS"
    kms_key         = aws_kms_key.data.arn
  }
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the last 30 images"
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 30 }
      action       = { type = "expire" }
    }]
  })
}

# ---- Roles -------------------------------------------------------------------------------------
data "aws_iam_policy_document" "ecs_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

# Used by ECS to start tasks: pull images, write logs, read the secrets into the environment.
resource "aws_iam_role" "execution" {
  name               = "${local.name}-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "execution_secrets" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_secretsmanager_secret.app.arn, aws_db_instance.main.master_user_secret[0].secret_arn]
  }
  statement {
    actions   = ["kms:Decrypt"]
    resources = [aws_kms_key.data.arn]
  }
}

resource "aws_iam_role_policy" "execution_secrets" {
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.execution_secrets.json
}

# Used by ZAPX itself while running: the files bucket and nothing else.
resource "aws_iam_role" "app" {
  name               = "${local.name}-app"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume.json
}

data "aws_iam_policy_document" "app" {
  statement {
    actions   = ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.files.arn}/*"]
  }
  statement {
    actions   = ["kms:Encrypt", "kms:Decrypt", "kms:GenerateDataKey"]
    resources = [aws_kms_key.data.arn]
  }
  dynamic "statement" {
    for_each = var.ecs_exec_enabled ? [1] : []
    content {
      sid       = "EcsExec"
      actions   = ["ssmmessages:CreateControlChannel", "ssmmessages:CreateDataChannel", "ssmmessages:OpenControlChannel", "ssmmessages:OpenDataChannel"]
      resources = ["*"]
    }
  }
}

resource "aws_iam_role_policy" "app" {
  role   = aws_iam_role.app.id
  policy = data.aws_iam_policy_document.app.json
}

# ---- Cluster and tasks -------------------------------------------------------------------------
resource "aws_ecs_cluster" "main" {
  name = local.name
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "app" {
  for_each          = toset(["api", "worker", "studio", "migrate"])
  name              = "/zapx/${var.environment}/${each.key}"
  retention_in_days = var.log_retention_days
  kms_key_id        = aws_kms_key.data.arn
}

locals {
  api_image    = "${aws_ecr_repository.app["api"].repository_url}:${var.image_tag}"
  studio_image = "${aws_ecr_repository.app["studio"].repository_url}:${var.image_tag}"

  # Settings shared by the API, the worker and the migration task (see .env.example).
  app_environment = merge({
    NODE_ENV                     = "production"
    COOKIE_SECURE                = "true"
    ALLOW_SIGNUP                 = "false"
    STUDIO_URL                   = "https://${var.studio_domain}"
    RUNTIME_BASE_URL             = "https://${var.runtime_domain}"
    CAPI_APP_URL                 = "https://${var.capi_domain}"
    DB_HOST                      = aws_db_instance.main.address
    DB_PORT                      = tostring(aws_db_instance.main.port)
    DB_NAME                      = aws_db_instance.main.db_name
    DB_SSLMODE                   = "require"
    FILE_STORE                   = "s3"
    S3_BUCKET                    = aws_s3_bucket.files.id
    S3_REGION                    = var.region
    S3_PREFIX                    = "files"
    S3_KMS_KEY_ID                = aws_kms_key.data.arn
    GEO_COUNTRY_HEADER           = "cloudfront-viewer-country"
    EDGE_CLIENT_ADDRESS_HEADER   = "cloudfront-viewer-address"
    TRUST_PROXY_HOPS             = "1"
    CALLBACK_ALLOW_PRIVATE_HOSTS = "false"
  }, var.app_environment)

  app_secrets = concat(
    [
      { name = "DB_USER", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:username::" },
      { name = "DB_PASSWORD", valueFrom = "${aws_db_instance.main.master_user_secret[0].secret_arn}:password::" },
      { name = "EDGE_SHARED_SECRET", valueFrom = "${aws_secretsmanager_secret.app.arn}:EDGE_SHARED_SECRET::" },
    ],
    [for k in var.app_secret_keys : { name = k, valueFrom = "${aws_secretsmanager_secret.app.arn}:${k}::" }],
  )

  app_container = {
    image                  = local.api_image
    essential              = true
    environment            = [for k, v in local.app_environment : { name = k, value = v }]
    secrets                = local.app_secrets
    readonlyRootFilesystem = false
    linuxParameters        = { initProcessEnabled = true }
  }

  log_config = { for k, g in aws_cloudwatch_log_group.app : k => {
    logDriver = "awslogs"
    options   = { "awslogs-group" = g.name, "awslogs-region" = var.region, "awslogs-stream-prefix" = k }
  } }
}

resource "aws_ecs_task_definition" "api" {
  family                   = "${local.name}-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([merge(local.app_container, {
    name         = "api"
    portMappings = [{ containerPort = 4000, protocol = "tcp" }]
    # The worker service runs the queues; the API only serves requests.
    environment      = concat(local.app_container.environment, [{ name = "JOB_WORKER", value = "off" }, { name = "CALLBACK_WORKER", value = "off" }])
    logConfiguration = local.log_config["api"]
    healthCheck = {
      command     = ["CMD", "node", "-e", "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval    = 15
      timeout     = 5
      retries     = 4
      startPeriod = 30
    }
  })])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 1024
  memory                   = 2048
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  container_definitions = jsonencode([merge(local.app_container, {
    name             = "worker"
    command          = ["node", "apps/api/dist/worker.js"]
    logConfiguration = local.log_config["worker"]
  })])
}

# Run once before each release (infra/scripts/deploy-aws.sh): applies database migrations and exits.
resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.app.arn
  container_definitions = jsonencode([merge(local.app_container, {
    name             = "migrate"
    command          = ["node", "apps/api/dist/cli/migrate.js"]
    logConfiguration = local.log_config["migrate"]
  })])
}

resource "aws_ecs_task_definition" "studio" {
  family                   = "${local.name}-studio"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  container_definitions = jsonencode([{
    name             = "studio"
    image            = local.studio_image
    essential        = true
    portMappings     = [{ containerPort = 3000, protocol = "tcp" }]
    environment      = [{ name = "NODE_ENV", value = "production" }]
    logConfiguration = local.log_config["studio"]
  }])
}

resource "aws_ecs_service" "api" {
  name                              = "api"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.api.arn
  desired_count                     = var.api_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  enable_execute_command            = var.ecs_exec_enabled
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.tasks.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 4000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # Autoscaling owns the running count after the first apply.
  lifecycle {
    ignore_changes = [desired_count]
  }
  depends_on = [aws_lb_listener.https]
}

resource "aws_ecs_service" "worker" {
  name                   = "worker"
  cluster                = aws_ecs_cluster.main.id
  task_definition        = aws_ecs_task_definition.worker.arn
  desired_count          = var.worker_desired_count
  launch_type            = "FARGATE"
  enable_execute_command = var.ecs_exec_enabled
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.tasks.id]
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
}

resource "aws_ecs_service" "studio" {
  name                              = "studio"
  cluster                           = aws_ecs_cluster.main.id
  task_definition                   = aws_ecs_task_definition.studio.arn
  desired_count                     = var.studio_desired_count
  launch_type                       = "FARGATE"
  health_check_grace_period_seconds = 60
  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.tasks.id]
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.studio.arn
    container_name   = "studio"
    container_port   = 3000
  }
  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  # Autoscaling owns the running count after the first apply.
  lifecycle {
    ignore_changes = [desired_count]
  }
  depends_on = [aws_lb_listener.https]
}
