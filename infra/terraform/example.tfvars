# Copy to <environment>.tfvars (ignored by git) and fill in. Secrets do not go here: put them in the
# app secret in Secrets Manager (see README.md), except edge_shared_secret, which CloudFront needs.
environment                = "staging"
region                     = "eu-west-1"
studio_domain              = "staging.zapx.example.com"
runtime_domain             = "take.staging.zapx.example.com"
capi_domain                = "field.staging.zapx.example.com"
api_origin_domain          = "origin.staging.zapx.example.com"
alb_certificate_arn        = "arn:aws:acm:eu-west-1:111122223333:certificate/REPLACE"
cloudfront_certificate_arn = "arn:aws:acm:us-east-1:111122223333:certificate/REPLACE"
image_tag                  = "set-by-deploy-script"
db_multi_az                = false
alarm_email                = "ops@example.com"
app_environment = {
  AI_MODEL     = ""
  BILLING      = "off"
  DEFAULT_PLAN = "free"
}
