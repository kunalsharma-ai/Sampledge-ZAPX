# 0020: Edge protection, autoscaling and backups on AWS

Status: Accepted (Milestone 14). Extends 0019's AWS stack.

## Context

The Milestone 13 stack listed WAF, autoscaling, AWS Backup and a way to reach the database as not
included. Respondent links are public and posted to panels, so the edge sees bots, scanners and
bursts from one address; fieldwork launches change load by an order of magnitude within minutes;
and RDS automated backups alone do not cover the files bucket or survive a deleted instance.

## Decision

- **AWS WAF in front of both entry points**: a CloudFront web ACL (us-east-1) for the runtime and
  CAPI app, and a regional one on the load balancer for the studio. Both use the free AWS managed
  rule groups (common, known bad inputs, IP reputation) and a per-address rate rule.
- **Managed rules start in count mode** (`waf_mode = "count"`); only the rate rule blocks. False
  positives on survey traffic (large CAPI sync bodies, HTML in question text, interview centres)
  would lose interviews, which costs more than a week of logging. Three rules that the ZAPX traffic
  is known to trip are count-only even in block mode.
- **The ALB rate rule skips CloudFront traffic** (requests carrying the edge secret): those all come
  from CloudFront addresses and were already limited per viewer by the edge ACL.
- **WAF logs keep only blocked and counted requests**, with the `authorization`, `cookie` and
  `x-zapx-edge` headers redacted.
- **Autoscaling on average CPU** for the API and studio (target 60%, between the desired count and a
  maximum). Terraform ignores `desired_count` after creation so an apply never scales a busy service
  down. The worker stays fixed (jobs are row-locked; one worker covers the expected volume).
- **AWS Backup** daily for RDS and the files bucket (35 days, KMS-encrypted vault), in addition to
  RDS point-in-time restore and S3 versioning.
- **ECS Exec, off by default**, as the way to reach the database (no bastion host, no open port);
  sessions are recorded in CloudTrail.

## Consequences

- About USD 15 a month for two web ACLs plus per-request charges; backup storage grows with data.
- Someone has to read the WAF logs and switch to block mode; the go-live checklist
  (`docs/operations/go-live.md`) includes it.
- All of it is validated and plan-tested against a mocked provider only, like the rest of the stack.
