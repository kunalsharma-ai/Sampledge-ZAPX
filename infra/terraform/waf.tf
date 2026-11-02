# ---- AWS WAF (Milestone 14) ---------------------------------------------------------------------
# Two web ACLs with the same AWS managed rule groups: one on the CloudFront distributions (respondents
# and interviewers; CloudFront ACLs must live in us-east-1) and one on the load balancer (the studio).
# The load balancer's rate rule leaves out requests from CloudFront: they all come from CloudFront
# addresses, and CloudFront's own ACL has already rate-limited them per viewer.
locals {
  waf_on = var.waf_mode != "off"
  waf_managed = {
    common        = { priority = 10, name = "AWSManagedRulesCommonRuleSet" }
    bad_inputs    = { priority = 20, name = "AWSManagedRulesKnownBadInputsRuleSet" }
    ip_reputation = { priority = 30, name = "AWSManagedRulesAmazonIpReputationList" }
  }
}

resource "aws_wafv2_web_acl" "edge" {
  count    = local.waf_on ? 1 : 0
  provider = aws.us_east_1
  name     = "${local.name}-edge"
  scope    = "CLOUDFRONT"
  default_action {
    allow {}
  }

  rule {
    name     = "rate-per-viewer"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-edge-rate"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.waf_managed
    content {
      name     = rule.value.name
      priority = rule.value.priority
      override_action {
        dynamic "none" {
          for_each = var.waf_mode == "block" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.waf_mode == "block" ? [] : [1]
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name
          dynamic "rule_action_override" {
            for_each = rule.value.name == "AWSManagedRulesCommonRuleSet" ? var.waf_count_only_rules : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name}-edge-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-edge"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl" "alb" {
  count = local.waf_on ? 1 : 0
  name  = "${local.name}-alb"
  scope = "REGIONAL"
  default_action {
    allow {}
  }

  rule {
    name     = "rate-per-address"
    priority = 1
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = var.waf_rate_limit
        aggregate_key_type = "IP"
        scope_down_statement {
          not_statement {
            statement {
              byte_match_statement {
                search_string         = var.edge_shared_secret
                positional_constraint = "EXACTLY"
                field_to_match {
                  single_header { name = "x-zapx-edge" }
                }
                text_transformation {
                  priority = 0
                  type     = "NONE"
                }
              }
            }
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "${local.name}-alb-rate"
      sampled_requests_enabled   = true
    }
  }

  dynamic "rule" {
    for_each = local.waf_managed
    content {
      name     = rule.value.name
      priority = rule.value.priority
      override_action {
        dynamic "none" {
          for_each = var.waf_mode == "block" ? [1] : []
          content {}
        }
        dynamic "count" {
          for_each = var.waf_mode == "block" ? [] : [1]
          content {}
        }
      }
      statement {
        managed_rule_group_statement {
          vendor_name = "AWS"
          name        = rule.value.name
          dynamic "rule_action_override" {
            for_each = rule.value.name == "AWSManagedRulesCommonRuleSet" ? var.waf_count_only_rules : []
            content {
              name = rule_action_override.value
              action_to_use {
                count {}
              }
            }
          }
        }
      }
      visibility_config {
        cloudwatch_metrics_enabled = true
        metric_name                = "${local.name}-alb-${rule.key}"
        sampled_requests_enabled   = true
      }
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "${local.name}-alb"
    sampled_requests_enabled   = true
  }
}

resource "aws_wafv2_web_acl_association" "alb" {
  count        = local.waf_on ? 1 : 0
  resource_arn = aws_lb.main.arn
  web_acl_arn  = aws_wafv2_web_acl.alb[0].arn
}

# WAF logs: blocked and counted requests only, without the headers that carry sessions or secrets.
resource "aws_cloudwatch_log_group" "waf_edge" {
  count             = local.waf_on ? 1 : 0
  provider          = aws.us_east_1
  name              = "aws-waf-logs-${local.name}-edge"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "waf_alb" {
  count             = local.waf_on ? 1 : 0
  name              = "aws-waf-logs-${local.name}-alb"
  retention_in_days = var.log_retention_days
}

resource "aws_wafv2_web_acl_logging_configuration" "edge" {
  count                   = local.waf_on ? 1 : 0
  provider                = aws.us_east_1
  resource_arn            = aws_wafv2_web_acl.edge[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf_edge[0].arn]
  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    single_header { name = "x-zapx-edge" }
  }
  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition { action = "BLOCK" }
      }
      condition {
        action_condition { action = "COUNT" }
      }
    }
  }
}

resource "aws_wafv2_web_acl_logging_configuration" "alb" {
  count                   = local.waf_on ? 1 : 0
  resource_arn            = aws_wafv2_web_acl.alb[0].arn
  log_destination_configs = [aws_cloudwatch_log_group.waf_alb[0].arn]
  redacted_fields {
    single_header { name = "authorization" }
  }
  redacted_fields {
    single_header { name = "cookie" }
  }
  redacted_fields {
    single_header { name = "x-zapx-edge" }
  }
  logging_filter {
    default_behavior = "DROP"
    filter {
      behavior    = "KEEP"
      requirement = "MEETS_ANY"
      condition {
        action_condition { action = "BLOCK" }
      }
      condition {
        action_condition { action = "COUNT" }
      }
    }
  }
}
