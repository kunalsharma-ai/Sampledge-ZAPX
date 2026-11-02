# ---- Load balancer: the studio, and /api for the studio and for CloudFront ---------------------
resource "aws_lb" "main" {
  name                       = local.name
  load_balancer_type         = "application"
  subnets                    = aws_subnet.public[*].id
  security_groups            = [aws_security_group.alb.id]
  drop_invalid_header_fields = true
  enable_deletion_protection = true
  idle_timeout               = 120
}

resource "aws_lb_target_group" "api" {
  name        = "${local.name}-api"
  port        = 4000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path                = "/api/health"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 15
  }
  deregistration_delay = 30
}

resource "aws_lb_target_group" "studio" {
  name        = "${local.name}-studio"
  port        = 3000
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id
  health_check {
    path    = "/login"
    matcher = "200"
  }
  deregistration_delay = 30
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn
  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }
}

# Studio: /api goes to the API, everything else to the studio.
resource "aws_lb_listener_rule" "studio_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    host_header { values = [var.studio_domain] }
  }
  condition {
    path_pattern { values = ["/api/*"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener_rule" "studio" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 20
  condition {
    host_header { values = [var.studio_domain] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.studio.arn
  }
}

# The origin name only answers CloudFront, recognized by the shared secret header.
resource "aws_lb_listener_rule" "edge_api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 30
  condition {
    host_header { values = [var.api_origin_domain] }
  }
  condition {
    path_pattern { values = ["/api/*"] }
  }
  condition {
    http_header {
      http_header_name = "X-Zapx-Edge"
      values           = [var.edge_shared_secret]
    }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

# ---- Static apps on S3 behind CloudFront (respondent runtime, CAPI app) -------------------------
locals {
  static_sites = {
    runtime = var.runtime_domain
    capi    = var.capi_domain
  }
}

resource "aws_s3_bucket" "static" {
  for_each      = local.static_sites
  bucket_prefix = "${local.name}-${each.key}-"
}

resource "aws_s3_bucket_public_access_block" "static" {
  for_each                = aws_s3_bucket.static
  bucket                  = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "static" {
  for_each = aws_s3_bucket.static
  bucket   = each.value.id
  rule { object_ownership = "BucketOwnerEnforced" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "static" {
  for_each = aws_s3_bucket.static
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_cloudfront_origin_access_control" "static" {
  name                              = "${local.name}-static"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

# Single-page apps: paths without a file extension load index.html. /api is a separate behavior.
resource "aws_cloudfront_function" "spa" {
  name    = "${local.name}-spa"
  runtime = "cloudfront-js-2.0"
  publish = true
  code    = <<-JS
    function handler(event) {
      var r = event.request;
      if (r.uri.indexOf('.') === -1) r.uri = '/index.html';
      return r;
    }
  JS
}

data "aws_cloudfront_cache_policy" "optimized" { name = "Managed-CachingOptimized" }
data "aws_cloudfront_cache_policy" "disabled" { name = "Managed-CachingDisabled" }
data "aws_cloudfront_origin_request_policy" "all_viewer" { name = "Managed-AllViewerExceptHostHeader" }
data "aws_cloudfront_response_headers_policy" "security" { name = "Managed-SecurityHeadersPolicy" }

# Forward the viewer's country and address to the API (GEO_COUNTRY_HEADER, EDGE_CLIENT_ADDRESS_HEADER).
resource "aws_cloudfront_origin_request_policy" "api" {
  name = "${local.name}-api"
  cookies_config { cookie_behavior = "all" }
  query_strings_config { query_string_behavior = "all" }
  headers_config {
    header_behavior = "allViewerAndWhitelistCloudFront"
    headers {
      items = ["CloudFront-Viewer-Country", "CloudFront-Viewer-Address"]
    }
  }
}

resource "aws_cloudfront_distribution" "static" {
  for_each            = local.static_sites
  enabled             = true
  is_ipv6_enabled     = true
  aliases             = [each.value]
  default_root_object = "index.html"
  price_class         = "PriceClass_All"
  comment             = "${local.name} ${each.key}"

  origin {
    origin_id                = "s3"
    domain_name              = aws_s3_bucket.static[each.key].bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.static.id
  }

  origin {
    origin_id   = "api"
    domain_name = var.api_origin_domain
    custom_origin_config {
      http_port              = 80
      https_port             = 443
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
      origin_read_timeout    = 60
    }
    custom_header {
      name  = "X-Zapx-Edge"
      value = var.edge_shared_secret
    }
  }

  default_cache_behavior {
    target_origin_id           = "s3"
    viewer_protocol_policy     = "redirect-to-https"
    allowed_methods            = ["GET", "HEAD", "OPTIONS"]
    cached_methods             = ["GET", "HEAD"]
    compress                   = true
    cache_policy_id            = data.aws_cloudfront_cache_policy.optimized.id
    response_headers_policy_id = data.aws_cloudfront_response_headers_policy.security.id
    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.spa.arn
    }
  }

  ordered_cache_behavior {
    path_pattern             = "/api/*"
    target_origin_id         = "api"
    viewer_protocol_policy   = "https-only"
    allowed_methods          = ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]
    cached_methods           = ["GET", "HEAD"]
    compress                 = true
    cache_policy_id          = data.aws_cloudfront_cache_policy.disabled.id
    origin_request_policy_id = aws_cloudfront_origin_request_policy.api.id
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate {
    acm_certificate_arn      = var.cloudfront_certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }
}

data "aws_iam_policy_document" "static" {
  for_each = local.static_sites
  statement {
    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.static[each.key].arn}/*"]
    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.static[each.key].arn]
    }
  }
}

resource "aws_s3_bucket_policy" "static" {
  for_each = local.static_sites
  bucket   = aws_s3_bucket.static[each.key].id
  policy   = data.aws_iam_policy_document.static[each.key].json
}
