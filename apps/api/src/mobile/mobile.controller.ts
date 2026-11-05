import { Controller, Get } from '@nestjs/common';
import { config } from '../config';
import { ALL_ROLES, Public, Roles } from '../auth/decorators';

/**
 * Settings the ZAPX mobile app (apps/mobile) needs from the server it signs in to. Feature access is
 * not here: that is GET /api/me/entitlements?surface=mobile, controlled by the super admin.
 */
@Controller('mobile')
export class MobileController {
  /** Public so the sign-in screen can check the address and refuse an app that is too old. */
  @Public()
  @Get('version')
  version() {
    return { service: 'zapx', minimumAppVersion: config().MOBILE_MIN_VERSION ?? null };
  }

  @Get('config')
  @Roles(...ALL_ROLES)
  settings() {
    const c = config();
    return {
      capiAppUrl: c.CAPI_APP_URL,
      runtimeBaseUrl: c.RUNTIME_BASE_URL,
      studioUrl: c.STUDIO_URL,
      minimumAppVersion: c.MOBILE_MIN_VERSION ?? null,
    };
  }
}
