import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, Query } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '@zapx/db';
import { SURVEY_TEMPLATES, bankBlockSchema, parseSurveyDefinition, questionSchema } from '@zapx/survey-schema';
import { PrismaService } from '../common/prisma.service';
import { AuditService } from '../common/audit.service';
import { parseBody } from '../common/validation';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Roles } from '../auth/decorators';

const itemSchema = z.object({
  kind: z.enum(['QUESTION', 'SURVEY', 'BLOCK']),
  name: z.string().trim().min(1).max(200),
  category: z.string().trim().min(1).max(60).default('General'),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  content: z.unknown(),
});
const updateSchema = itemSchema.omit({ kind: true, content: true }).partial();

/** Check that the content is a valid question or survey, and return its canonical form. */
export function validLibraryContent(kind: 'QUESTION' | 'SURVEY' | 'BLOCK', content: unknown): Prisma.InputJsonValue {
  if (kind === 'BLOCK') {
    const b = bankBlockSchema.safeParse(content);
    if (!b.success) throw new BadRequestException(`Not a valid block of pages: ${b.error.issues[0]?.message ?? 'invalid'}`);
    return b.data as unknown as Prisma.InputJsonValue;
  }
  if (kind === 'QUESTION') {
    const q = questionSchema.safeParse(content);
    if (!q.success) throw new BadRequestException(`Not a valid question: ${q.error.issues[0]?.message ?? 'invalid'}`);
    return q.data as unknown as Prisma.InputJsonValue;
  }
  const s = parseSurveyDefinition(content);
  if (!s.ok) throw new BadRequestException(`Not a valid survey: ${s.issues[0]?.message ?? 'invalid'}`);
  return s.definition as unknown as Prisma.InputJsonValue;
}

/**
 * Blueprint phase 1: the question bank. Questions and whole surveys saved for reuse across the
 * organization, plus the built-in survey templates.
 */
@Controller()
export class LibraryController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Get('library/templates')
  templates() {
    return SURVEY_TEMPLATES.map(({ definition, ...t }) => ({
      ...t,
      questions: definition.pages.reduce((n, p) => n + (p.questions?.length ?? 0), 0),
    }));
  }

  @Get('library')
  list(@CurrentUser() user: AuthUser, @Query('kind') kind?: string, @Query('q') q?: string) {
    const where: Prisma.LibraryItemWhereInput = { tenantId: user.tenantId };
    if (kind === 'QUESTION' || kind === 'SURVEY' || kind === 'BLOCK') where.kind = kind;
    const text = q?.trim().slice(0, 100);
    if (text)
      where.OR = [
        { name: { contains: text, mode: 'insensitive' } },
        { category: { contains: text, mode: 'insensitive' } },
        { tags: { has: text } },
      ];
    return this.prisma.libraryItem.findMany({ where, orderBy: [{ category: 'asc' }, { name: 'asc' }], take: 500 });
  }

  @Post('library')
  @Roles(...CAN_EDIT)
  async create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const b = parseBody(itemSchema, body);
    const content = validLibraryContent(b.kind, b.content);
    const item = await this.prisma.libraryItem.create({
      data: {
        tenantId: user.tenantId,
        kind: b.kind,
        name: b.name,
        category: b.category,
        tags: [...new Set(b.tags)],
        content,
        createdById: user.id,
      },
    });
    await this.audit.record(user, 'library.create', 'library_item', item.id, { kind: b.kind, name: b.name });
    return item;
  }

  @Put('library/:id')
  @Roles(...CAN_EDIT)
  async update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    const b = parseBody(updateSchema, body);
    await this.find(user, id);
    const item = await this.prisma.libraryItem.update({
      where: { id },
      data: { ...b, ...(b.tags ? { tags: [...new Set(b.tags)] } : {}) },
    });
    await this.audit.record(user, 'library.update', 'library_item', id, b);
    return item;
  }

  @Delete('library/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    const item = await this.find(user, id);
    await this.prisma.libraryItem.delete({ where: { id } });
    await this.audit.record(user, 'library.delete', 'library_item', id, { name: item.name });
  }

  private async find(user: AuthUser, id: string) {
    const item = await this.prisma.libraryItem.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!item) throw new NotFoundException('Question bank item not found');
    return item;
  }
}
