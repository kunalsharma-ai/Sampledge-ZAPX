import { PlanService } from '../plans/plan.service';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { AccessService } from './access.service';
import { PlanCatalogService } from '../super-admin/plan-catalog.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, AccessService, PlanCatalogService, PlanService],
  exports: [PrismaService, AuditService, AccessService, PlanCatalogService, PlanService],
})
export class CommonModule {}
