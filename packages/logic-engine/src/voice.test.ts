import { describe, expect, it } from 'vitest';
import { parseVoiceCommand } from './index.js';

describe('voice commands', () => {
  it('navigates between tabs', () => {
    expect(parseVoiceCommand('Open the programmer')).toEqual({ kind: 'tab', tab: 'code' });
    expect(parseVoiceCommand('go to translations tab')).toEqual({ kind: 'tab', tab: 'languages' });
    expect(parseVoiceCommand('Hey ZAPX, show me quotas.')).toEqual({ kind: 'tab', tab: 'results' });
    expect(parseVoiceCommand('preview')).toEqual({ kind: 'tab', tab: 'preview' });
    expect(parseVoiceCommand('open the moon')).toEqual({ kind: 'none' });
  });

  it('saves, but never publishes by voice', () => {
    expect(parseVoiceCommand('Save draft')).toEqual({ kind: 'save' });
    expect(parseVoiceCommand('publish the survey')).toEqual({ kind: 'ai', instruction: 'publish the survey' });
  });

  it('sends anything else to the AI architect as an instruction', () => {
    expect(parseVoiceCommand('ZAPX, add a region question after gender with North and South')).toEqual({
      kind: 'ai',
      instruction: 'add a region question after gender with North and South',
    });
    expect(parseVoiceCommand('   ')).toEqual({ kind: 'none' });
  });
});
