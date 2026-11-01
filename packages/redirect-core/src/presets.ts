import type { RedirectMode } from './adapters';
import type { StatusUrls, StatusWords } from './layers';

export interface RedirectPreset {
  id: string;
  name: string;
  redirectMode: RedirectMode;
  staticUrls: StatusUrls;
  statusWords: StatusWords;
}

const SAMPLEDGE = 'https://platform.sampledge.com/response/status?status=[STATUS]&uid=[UID]';

/** Ready-made vendor configurations. */
export const REDIRECT_PRESETS: RedirectPreset[] = [
  {
    id: 'sampledge-platform',
    name: 'Sampledge platform (static)',
    redirectMode: 'STATIC',
    staticUrls: { complete: SAMPLEDGE, terminate: SAMPLEDGE, quota_full: SAMPLEDGE, security_reject: SAMPLEDGE },
    statusWords: {
      complete: 'complete',
      terminate: 'terminate',
      quota_full: 'overquota',
      quality_fail: 'terminate',
      security_reject: 'security',
      duplicate: 'security',
      partial: 'terminate',
      technical_error: 'terminate',
    },
  },
];
