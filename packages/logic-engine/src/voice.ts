/**
 * Blueprint phase 2: voice commands in the studio. Speech recognition runs in the browser; this
 * turns the transcript into a command. Navigation and saving happen directly; anything else becomes
 * an instruction for the AI architect, which drafts a change set for review (never applied silently).
 * Publishing is deliberately not a voice command.
 */
export type VoiceCommand = { kind: 'tab'; tab: string } | { kind: 'save' } | { kind: 'ai'; instruction: string } | { kind: 'none' };

/** Spoken words for each survey tab (English). */
const TAB_WORDS: Array<[string, string[]]> = [
  ['build', ['build', 'builder', 'visual builder', 'editor', 'outline']],
  ['json', ['json']],
  ['code', ['programmer', 'code', 'xml', 'debugger', 'dependencies', 'scripting']],
  ['assist', ['ai', 'assistant', 'architect', 'import', 'ai and import', 'copilot']],
  ['design', ['design', 'theme', 'look']],
  ['languages', ['languages', 'language', 'translations', 'translation']],
  ['preview', ['preview']],
  ['qa', ['qa', 'q a', 'qa lab', 'testing', 'tests', 'test cases', 'quality assurance']],
  ['distribute', ['links', 'link', 'distribution', 'status']],
  ['capi', ['interviewers', 'fieldwork assignments', 'capi']],
  ['quality', ['quality', 'fraud', 'fieldwork']],
  ['results', ['quotas', 'quota', 'results', 'data', 'exports', 'export']],
  ['analysis', ['analysis', 'crosstabs', 'tables', 'charts']],
];

const clean = (s: string) =>
  s
    .toLowerCase()
    .replace(/[.,!?;:"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function parseVoiceCommand(transcript: string): VoiceCommand {
  const raw = transcript.trim().replace(/^(hey |ok |okay )?(sampcode|samp code|zapx|zap x)[,:]?\s*/i, '');
  const t = clean(raw);
  if (!t) return { kind: 'none' };
  if (/^(save|save (the )?(draft|survey|changes))( please)?$/.test(t)) return { kind: 'save' };
  const nav = t.match(/^(?:open|go to|show(?: me)?|switch to|take me to)\s+(?:the\s+)?(.+?)(?:\s+(?:tab|page|panel|view))?$/);
  const target = nav ? nav[1]! : t;
  for (const [tab, words] of TAB_WORDS) if (words.includes(target)) return { kind: 'tab', tab };
  if (nav) {
    // "open the x" for an unknown x is still a navigation attempt, not an edit.
    return { kind: 'none' };
  }
  return { kind: 'ai', instruction: raw.trim() };
}
