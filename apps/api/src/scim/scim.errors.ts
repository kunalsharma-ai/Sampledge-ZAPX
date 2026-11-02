import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

export const SCIM_ERROR = 'urn:ietf:params:scim:api:messages:2.0:Error';
export const SCIM_CONTENT_TYPE = 'application/scim+json';

/** An error in SCIM's own format (RFC 7644 section 3.12). */
export class ScimError extends HttpException {
  constructor(status: number, detail: string, scimType?: string) {
    super({ schemas: [SCIM_ERROR], status: String(status), detail, ...(scimType ? { scimType } : {}) }, status);
  }
}

/** Every error from the SCIM endpoints is answered in SCIM's error format. */
@Catch()
export class ScimExceptionFilter implements ExceptionFilter {
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let body: Record<string, unknown> = { schemas: [SCIM_ERROR], status: '500', detail: 'Internal error' };
    if (err instanceof ScimError) {
      status = err.getStatus();
      body = err.getResponse() as Record<string, unknown>;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse() as { message?: string | string[]; code?: string } | string;
      const detail = typeof r === 'string' ? r : Array.isArray(r.message) ? r.message.join(', ') : (r.message ?? err.message);
      body = {
        schemas: [SCIM_ERROR],
        status: String(status),
        detail,
        ...(typeof r === 'object' && r.code === 'PLAN_LIMIT' ? { scimType: 'tooMany' } : {}),
      };
    }
    res.status(status).type(SCIM_CONTENT_TYPE).send(JSON.stringify(body));
  }
}
