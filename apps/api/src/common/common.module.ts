import { PlanService } from '../plans/plan.service';
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AuditService } from './audit.service';
import { AccessService } from './access.service';

@Global()
@Module({
  providers: [PrismaService, AuditService, AccessService, PlanService],
  exports: [PrismaService, AuditService, AccessService, PlanService],
})
export class CommonModule {}
