variable "environment" {
  description = "Environment name: staging or production."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,19}$", var.environment))
    error_message = "Use lower-case letters, digits and dashes."
  }
}

variable "region" {
  description = "AWS region for everything except CloudFront certificates."
  type        = string
  default     = "eu-west-1"
}

variable "vpc_cidr" {
  type    = string
  default = "10.40.0.0/16"
}

variable "nat_gateway_per_az" {
  description = "One NAT gateway per availability zone (resilient) instead of one shared (cheaper)."
  type        = bool
  default     = false
}

# ---- Addresses ---------------------------------------------------------------------------------
variable "studio_domain" {
  description = "Where research teams use SampCode, e.g. zapx.sampledge.com. Served by the load balancer."
  type        = string
}

variable "runtime_domain" {
  description = "Where respondents take surveys, e.g. take.zapx.sampledge.com. Served by CloudFront."
  type        = string
}

variable "capi_domain" {
  description = "Where interviewers open the offline app, e.g. field.zapx.sampledge.com. Served by CloudFront."
  type        = string
}

variable "api_origin_domain" {
  description = "Name CloudFront uses to reach the load balancer for /api (covered by alb_certificate_arn), e.g. origin.zapx.sampledge.com."
  type        = string
}

variable "alb_certificate_arn" {
  description = "ACM certificate in var.region covering studio_domain and api_origin_domain."
  type        = string
}

variable "cloudfront_certificate_arn" {
  description = "ACM certificate in us-east-1 covering runtime_domain and capi_domain."
  type        = string
}

# ---- Application -------------------------------------------------------------------------------
variable "image_tag" {
  description = "Image tag to run (the git commit), pushed to the ECR repositories this stack creates."
  type        = string
}

variable "api_desired_count" {
  type    = number
  default = 2
}

variable "studio_desired_count" {
  type    = number
  default = 2
}

variable "worker_desired_count" {
  type    = number
  default = 1
}

variable "api_cpu" {
  type    = number
  default = 1024
}

variable "api_memory" {
  type    = number
  default = 2048
}

variable "app_environment" {
  description = "Extra non-secret settings for the API and worker (see .env.example), e.g. { AI_MODEL = \"...\", BILLING = \"stripe\" }."
  type        = map(string)
  default     = {}
}

variable "app_secret_keys" {
  description = "Keys of the app secret (Secrets Manager JSON) passed to the API and worker. Values are set outside Terraform. Provider keys (Claude, Stripe, IPinfo, Deepgram, Twilio) are entered in the CRM under Settings > Integrations instead; add them here only to keep them in Secrets Manager."
  type        = list(string)
  default     = ["JWT_SECRET", "SECRETS_KEY", "SIGNING_KEYS_SECRET", "ANTHROPIC_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "IPINFO_TOKEN", "DEEPGRAM_API_KEY", "TWILIO_AUTH_TOKEN", "SENDGRID_API_KEY"]
}

# ---- Database ----------------------------------------------------------------------------------
variable "db_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "db_allocated_storage" {
  type    = number
  default = 50
}

variable "db_multi_az" {
  type    = bool
  default = true
}

variable "db_backup_retention_days" {
  type    = number
  default = 14
}

variable "log_retention_days" {
  type    = number
  default = 30
}

variable "alarm_email" {
  description = "Email address subscribed to the alarm topic (confirm the subscription email). Empty for none."
  type        = string
  default     = ""
}

variable "edge_shared_secret" {
  description = "Random string (32+ characters) CloudFront sends to the load balancer as X-Zapx-Edge. Only requests carrying it may use the respondent /api origin, and only they are trusted for the viewer's address and country."
  type        = string
  sensitive   = true
  validation {
    condition     = length(var.edge_shared_secret) >= 32
    error_message = "Use at least 32 random characters, e.g. openssl rand -hex 32."
  }
}

# ---- Protection, scaling and backups (Milestone 14) --------------------------------------------
variable "waf_mode" {
  description = "AWS WAF on CloudFront and the load balancer: \"count\" (log what the managed rules would block, block nothing), \"block\", or \"off\". Start with count and switch to block after reading the WAF logs for a week of real fieldwork."
  type        = string
  default     = "count"
  validation {
    condition     = contains(["off", "count", "block"], var.waf_mode)
    error_message = "Use off, count or block."
  }
}

variable "waf_rate_limit" {
  description = "Requests per 5 minutes from one address before WAF blocks it (rate rules always block unless waf_mode is off). Interview centres behind one address need a higher value."
  type        = number
  default     = 3000
  validation {
    condition     = var.waf_rate_limit >= 100
    error_message = "AWS WAF needs at least 100."
  }
}

variable "waf_sign_in_rate_limit" {
  description = "Requests per 5 minutes from one address to /api/auth/ (sign-in, SSO) before WAF blocks it. Rate rules always block unless waf_mode is off."
  type        = number
  default     = 100
  validation {
    condition     = var.waf_sign_in_rate_limit >= 10 && var.waf_sign_in_rate_limit <= var.waf_rate_limit
    error_message = "Use at least 10 (the WAF minimum) and no more than waf_rate_limit."
  }
}

variable "waf_count_only_rules" {
  description = "Managed rules that only count, even in block mode: large bodies (CAPI sync, uploads) and HTML in question text trip these."
  type        = list(string)
  default     = ["SizeRestrictions_BODY", "CrossSiteScripting_BODY", "NoUserAgent_HEADER"]
}

variable "api_max_count" {
  description = "Most API tasks autoscaling may run (it never goes below api_desired_count)."
  type        = number
  default     = 6
}

variable "studio_max_count" {
  type    = number
  default = 4
}

variable "autoscaling_cpu_target" {
  description = "Average CPU (percent) the API and studio services scale to keep."
  type        = number
  default     = 60
}

variable "backup_enabled" {
  description = "AWS Backup of the database and the files bucket, in addition to the RDS automated backups."
  type        = bool
  default     = true
}

variable "backup_retention_days" {
  type    = number
  default = 35
}

variable "ecs_exec_enabled" {
  description = "Allow `aws ecs execute-command` into the API and worker tasks (Session Manager, audited in CloudTrail). Off by default; turn on when someone needs to reach the database."
  type        = bool
  default     = false
}
