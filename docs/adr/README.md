# Architecture Decision Records

Each record states one decision, why it was made and what it costs. Records are not edited after
they are accepted; a later record supersedes an earlier one.

| #                                                | Decision                                                               | Status                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| [0001](0001-modular-monolith.md)                 | Modular monolith with separable modules                                | Accepted                                               |
| [0002](0002-prisma-and-repository-boundaries.md) | Prisma on PostgreSQL, behind repository boundaries                     | Accepted                                               |
| [0003](0003-redirect-and-vendor-integration.md)  | Redirect & Vendor Integration module, and how ZAPX connects to PROJEXA | Accepted                                               |
| [0004](0004-ai-gateway.md)                       | AI model gateway                                                       | Accepted                                               |
| [0005](0005-aws-deployment.md)                   | Containers locally, AWS (ECS/Fargate) in production                    | Accepted                                               |
| [0006](0006-engineering-governance.md)           | Engineering governance and quality gates                               | Accepted (CI and branch protection superseded by 0009) |
| [0007](0007-data-quality.md)                     | Data quality scoring with human review                                 | Accepted                                               |
| [0008](0008-capi-offline-app.md)                 | Offline CAPI app with server-side replay                               | Accepted                                               |
| [0009](0009-local-quality-gates.md)              | Quality gates run locally; GitHub Actions is optional                  | Accepted                                               |
| [0010](0010-project-access-and-api-keys.md)      | Project-level access and organization API keys                         | Accepted                                               |
| [0011](0011-outbound-webhooks.md)                | Signed outbound webhooks                                               | Accepted                                               |
| [0012](0012-row-level-security.md)               | PostgreSQL row-level security on respondent data                       | Accepted                                               |
| [0013](0013-background-jobs-and-file-storage.md) | Background jobs and file storage in PostgreSQL                         | Accepted (file storage extended by 0019)               |
| [0014](0014-sso-scim-and-plans.md)               | Single sign-on, SCIM provisioning and plan limits                      | Accepted (SAML and billing added by 0019)              |
| [0015](0015-cati-call-lists.md)                  | CATI call lists on the existing interview engine                       | Accepted                                               |
| [0016](0016-analysis-and-reports.md)             | Survey analysis and saved reports in the API                           | Accepted                                               |
| [0017](0017-rich-media-and-question-types.md)    | Rich media and advanced question types                                 | Accepted                                               |
| [0018](0018-fraud-detection-and-capi-capture.md) | Fraud detection and face-to-face capture                               | Accepted                                               |
| [0019](0019-production-readiness.md)             | Production readiness: S3, SAML, billing, AWS and the PROJEXA check     | Accepted                                               |
| [0020](0020-edge-protection-scaling-backups.md)  | Edge protection, autoscaling and backups on AWS                        | Accepted                                               |

Template: copy an existing record; sections are Context, Decision, Consequences.
