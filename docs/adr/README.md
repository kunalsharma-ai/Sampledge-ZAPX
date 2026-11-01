# Architecture Decision Records

Each record states one decision, why it was made and what it costs. Records are not edited after
they are accepted; a later record supersedes an earlier one.

| #                                                | Decision                                                               | Status   |
| ------------------------------------------------ | ---------------------------------------------------------------------- | -------- |
| [0001](0001-modular-monolith.md)                 | Modular monolith with separable modules                                | Accepted |
| [0002](0002-prisma-and-repository-boundaries.md) | Prisma on PostgreSQL, behind repository boundaries                     | Accepted |
| [0003](0003-redirect-and-vendor-integration.md)  | Redirect & Vendor Integration module, and how ZAPX connects to PROJEXA | Accepted |
| [0004](0004-ai-gateway.md)                       | AI model gateway                                                       | Accepted |
| [0005](0005-aws-deployment.md)                   | Containers locally, AWS (ECS/Fargate) in production                    | Accepted |
| [0006](0006-engineering-governance.md)           | Engineering governance and quality gates                               | Accepted |

Template: copy an existing record; sections are Context, Decision, Consequences.
