import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UploadedFile as UploadedFileParam,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { AuthUser } from '../auth/auth.types';
import { CAN_EDIT, CurrentUser, Public, Roles } from '../auth/decorators';
import type { UploadedFile } from '../imports/documents';
import { config } from '../config';
import { MediaService } from './media.service';

/** Media library of a survey (Milestone 11). */
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Get('surveys/:id/media')
  list(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.media.list(user, id);
  }

  @Post('surveys/:id/media')
  @Roles(...CAN_EDIT)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: config().MEDIA_MAX_MB * 1024 * 1024, files: 1, fields: 5 } }))
  upload(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFileParam() file?: UploadedFile) {
    if (!file) throw new BadRequestException('Attach a file');
    return this.media.upload(user, id, file.originalname, file.buffer);
  }

  @Delete('media/:id')
  @Roles(...CAN_EDIT)
  @HttpCode(204)
  remove(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.media.remove(user, id);
  }

  /**
   * Respondents, the studio preview and the CAPI app load media here. The id is the only key, so it is
   * random; files never change under an id, so they can be cached for a year. Supports byte ranges,
   * which browsers need to seek in video.
   */
  @Public()
  @SkipThrottle()
  @Get('public/media/:id')
  async serve(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const { meta, data } = await this.media.publicFile(id);
    res.setHeader('Content-Type', meta.contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('ETag', `"${meta.sha256}"`);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    res.setHeader('Accept-Ranges', 'bytes');
    if (req.headers['if-none-match'] === `"${meta.sha256}"`) {
      res.status(304).end();
      return;
    }
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : data.length - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : data.length - 1;
      start = Math.max(0, start);
      end = Math.min(end, data.length - 1);
      if (start > end) {
        res.status(416).setHeader('Content-Range', `bytes */${data.length}`).end();
        return;
      }
      res.status(206).setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
      res.setHeader('Content-Length', String(end - start + 1));
      res.end(data.subarray(start, end + 1));
      return;
    }
    res.setHeader('Content-Length', String(data.length));
    res.end(data);
  }
}
