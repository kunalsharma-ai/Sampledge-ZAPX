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
  description = "Where research teams use ZAPX, e.g. zapx.sampledge.com. Served by the load balancer."
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
  description = "Keys of the app secret (Secrets Manager JSON) passed to the API and worker. Values are set outside Terraform."
  type        = list(string)
  default     = ["JWT_SECRET", "SECRETS_KEY", "ANTHROPIC_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET"]
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
