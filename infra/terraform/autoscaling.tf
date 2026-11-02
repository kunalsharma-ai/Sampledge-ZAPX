# ---- Autoscaling (Milestone 14) -----------------------------------------------------------------
# The API and the studio scale on average CPU between their desired count and a maximum. The worker
# stays fixed: jobs are claimed with row locks, so more workers only help with many long exports.
locals {
  scaled_services = {
    api    = { min = var.api_desired_count, max = var.api_max_count, service = aws_ecs_service.api.name }
    studio = { min = var.studio_desired_count, max = var.studio_max_count, service = aws_ecs_service.studio.name }
  }
}

resource "aws_appautoscaling_target" "service" {
  for_each           = local.scaled_services
  service_namespace  = "ecs"
  scalable_dimension = "ecs:service:DesiredCount"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${each.value.service}"
  min_capacity       = each.value.min
  max_capacity       = max(each.value.min, each.value.max)
}

resource "aws_appautoscaling_policy" "cpu" {
  for_each           = local.scaled_services
  name               = "${local.name}-${each.key}-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.service[each.key].service_namespace
  scalable_dimension = aws_appautoscaling_target.service[each.key].scalable_dimension
  resource_id        = aws_appautoscaling_target.service[each.key].resource_id
  target_tracking_scaling_policy_configuration {
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 300
    scale_out_cooldown = 60
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
  }
}
