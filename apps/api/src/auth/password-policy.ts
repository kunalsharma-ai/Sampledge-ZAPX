/**
 * Refuses passwords that attackers try first (Milestone 20). Length is checked by the schemas
 * (10+ characters); this catches the long passwords that are still on every guessing list.
 */
const COMMON = new Set(
  [
    '1234567890',
    '12345678910',
    '123456789012',
    '0987654321',
    '1q2w3e4r5t',
    '1qaz2wsx3edc',
    'qwertyuiop',
    'qwerty12345',
    'qwerty123456',
    'asdfghjkl;',
    'zaq12wsxcde3',
    'password12',
    'password123',
    'password1234',
    'password!23',
    'passw0rd123',
    'p@ssw0rd123',
    'p@ssword123',
    'iloveyou123',
    'welcome123',
    'welcome1234',
    'letmein123',
    'administrator',
    'admin12345',
    'admin123456',
    'adminadmin',
    'changeme123',
    'football123',
    'baseball123',
    'princess123',
    'sunshine123',
    'abcdefghij',
    'abc1234567',
    'abcd123456',
    'trustno1234',
    'superman123',
    'monkey12345',
    'dragon12345',
    'master12345',
    'qwertyqwerty',
    'zapx123456',
    'zapx-admin-123',
    'sampledge123',
  ].map((p) => p.toLowerCase()),
);

export function isCommonPassword(password: string): boolean {
  const p = password.toLowerCase();
  if (COMMON.has(p)) return true;
  // One character repeated, or a short pattern repeated ("abcabcabcabc").
  if (/^(.{1,4})\1+$/.test(p)) return true;
  // A run of consecutive characters ("abcdefghijk", "9876543210").
  let up = 1;
  let down = 1;
  for (let i = 1; i < p.length; i++) {
    up = p.charCodeAt(i) - p.charCodeAt(i - 1) === 1 ? up + 1 : 1;
    down = p.charCodeAt(i - 1) - p.charCodeAt(i) === 1 ? down + 1 : 1;
    if (up === p.length || down === p.length) return true;
  }
  return false;
}
