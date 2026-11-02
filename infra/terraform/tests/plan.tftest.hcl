# Plans the whole stack against a mocked AWS provider (no account, no network): catches broken
# references, counts and validations. Run: terraform init -backend=false && terraform test
mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = { names = ["eu-west-1a", "eu-west-1b", "eu-west-1c"] }
  }
  mock_data "aws_caller_identity" {
    defaults = { account_id = "111122223333" }
  }
  mock_data "aws_iam_policy_document" {
    defaults = { json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}" }
  }
  mock_resource "aws_db_instance" {
    defaults = {
      address            = "zapx-staging.abc.eu-west-1.rds.amazonaws.com"
      port               = 5432
      arn                = "arn:aws:rds:eu-west-1:111122223333:db:zapx-staging"
      master_user_secret = [{ secret_arn = "arn:aws:secretsmanager:eu-west-1:111122223333:secret:rds-abc", kms_key_id = "k", secret_status = "active" }]
    }
  }
  mock_resource "aws_kms_key" {
    defaults = { arn = "arn:aws:kms:eu-west-1:111122223333:key/abc" }
  }
  mock_resource "aws_ecr_repository" {
    defaults = { repository_url = "111122223333.dkr.ecr.eu-west-1.amazonaws.com/zapx-staging-api" }
  }
  mock_resource "aws_cloudfront_function" {
    defaults = { arn = "arn:aws:cloudfront::111122223333:function/zapx-staging-spa" }
  }
  mock_resource "aws_sns_topic" {
    defaults = { arn = "arn:aws:sns:eu-west-1:111122223333:zapx-staging-alarms" }
  }
  mock_resource "aws_iam_role" {
    defaults = { arn = "arn:aws:iam::111122223333:role/zapx-staging" }
  }
  mock_resource "aws_lb" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:loadbalancer/app/zapx-staging/abc", arn_suffix = "app/zapx-staging/abc" }
  }
  mock_resource "aws_lb_target_group" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:targetgroup/zapx-staging/abc", arn_suffix = "targetgroup/zapx-staging/abc" }
  }
  mock_resource "aws_lb_listener" {
    defaults = { arn = "arn:aws:elasticloadbalancing:eu-west-1:111122223333:listener/app/zapx-staging/abc/def" }
  }
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:eu-west-1:111122223333:regional/webacl/zapx-staging-alb/abc" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:eu-west-1:111122223333:log-group:aws-waf-logs-zapx-staging-alb" }
  }
  mock_resource "aws_s3_bucket" {
    defaults = { arn = "arn:aws:s3:::zapx-staging-files-abc", id = "zapx-staging-files-abc", bucket_regional_domain_name = "zapx-staging-files-abc.s3.eu-west-1.amazonaws.com" }
  }
  mock_resource "aws_secretsmanager_secret" {
    defaults = { arn = "arn:aws:secretsmanager:eu-west-1:111122223333:secret:zapx-staging/app" }
  }
}

mock_provider "aws" {
  alias = "us_east_1"
  mock_resource "aws_wafv2_web_acl" {
    defaults = { arn = "arn:aws:wafv2:us-east-1:111122223333:global/webacl/zapx-staging-edge/abc" }
  }
  mock_resource "aws_cloudwatch_log_group" {
    defaults = { arn = "arn:aws:logs:us-east-1:111122223333:log-group:aws-waf-logs-zapx-staging-edge" }
  }
}

variables {
  environment                = "staging"
  studio_domain              = "staging.zapx.example.com"
  runtime_domain             = "take.staging.zapx.example.com"
  capi_domain                = "field.staging.zapx.example.com"
  api_origin_domain          = "origin.staging.zapx.example.com"
  alb_certificate_arn        = "arn:aws:acm:eu-west-1:111122223333:certificate/a"
  cloudfront_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/b"
  image_tag                  = "abc123"
  edge_shared_secret         = "0123456789abcdef0123456789abcdef"
}

run "plan" {
  command = apply

  assert {
    condition     = length(aws_subnet.private) == 2 && length(aws_nat_gateway.main) == 1
    error_message = "Two private subnets and one shared NAT gateway by default"
  }
  assert {
    condition     = aws_db_instance.main.storage_encrypted && aws_db_instance.main.deletion_protection && aws_db_instance.main.manage_master_user_password
    error_message = "The database must be encrypted, protected from deletion and use a managed password"
  }
  assert {
    condition     = aws_s3_bucket_public_access_block.files.block_public_policy && aws_s3_bucket_public_access_block.files.restrict_public_buckets
    error_message = "The files bucket must not be public"
  }
  assert {
    condition     = jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[index(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[*].name, "FILE_STORE")].value == "s3"
    error_message = "The API must use the S3 file store"
  }
  assert {
    condition     = contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].secrets[*].name, "DB_PASSWORD")
    error_message = "The database password must come from the RDS secret"
  }
  assert {
    condition     = !contains(jsondecode(aws_ecs_task_definition.api.container_definitions)[0].environment[*].name, "JWT_SECRET")
    error_message = "Secrets must not be plain environment variables"
  }
  assert {
    condition     = length(aws_cloudfront_distribution.static) == 2
    error_message = "Runtime and CAPI each have a CloudFront distribution"
  }
  assert {
    condition     = alltrue([for d in aws_cloudfront_distribution.static : d.web_acl_id == aws_wafv2_web_acl.edge[0].arn]) && length(aws_wafv2_web_acl_association.alb) == 1
    error_message = "WAF is in front of CloudFront and the load balancer by default"
  }
  assert {
    condition     = length(one([for r in aws_wafv2_web_acl.alb[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].count) == 1
    error_message = "Managed rules start in count mode"
  }
  assert {
    condition     = aws_appautoscaling_target.service["api"].min_capacity == 2 && aws_appautoscaling_target.service["api"].max_capacity == 6
    error_message = "The API scales between 2 and 6 tasks"
  }
  assert {
    condition     = length(aws_backup_selection.main) == 1 && length(aws_backup_selection.main[0].resources) == 2
    error_message = "AWS Backup covers the database and the files bucket"
  }
  assert {
    condition     = !aws_ecs_service.api.enable_execute_command
    error_message = "ECS Exec is off unless asked for"
  }
}

run "waf_block" {
  command = plan
  variables {
    waf_mode = "block"
  }
  assert {
    condition     = length(one([for r in aws_wafv2_web_acl.edge[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].none) == 1 && length(one([for r in aws_wafv2_web_acl.edge[0].rule : r if r.name == "AWSManagedRulesCommonRuleSet"]).override_action[0].count) == 0
    error_message = "Block mode lets the managed rules block"
  }
}

run "waf_off" {
  command = plan
  variables {
    waf_mode         = "off"
    backup_enabled   = false
    ecs_exec_enabled = true
  }
  assert {
    condition     = length(aws_wafv2_web_acl.edge) == 0 && length(aws_backup_plan.main) == 0 && aws_ecs_service.api.enable_execute_command
    error_message = "WAF and backups can be turned off, ECS Exec on"
  }
}

run "bad_waf_mode_is_refused" {
  command = plan
  variables {
    waf_mode = "maybe"
  }
  expect_failures = [var.waf_mode]
}

run "short_edge_secret_is_refused" {
  command = plan
  variables {
    edge_shared_secret = "too-short"
  }
  expect_failures = [var.edge_shared_secret]
}

run "nat_per_az" {
  command = plan
  variables {
    nat_gateway_per_az = true
  }
  assert {
    condition     = length(aws_nat_gateway.main) == 2
    error_message = "One NAT gateway per zone when asked"
  }
}
