/**
 * Removes personal data from text before it is sent to an AI provider: e-mail addresses,
 * phone numbers, payment card numbers (Luhn-checked) and IBANs. Survey questionnaires rarely
 * need these, and a brief or uploaded document may contain them by accident.
 *
 * Limits: PDFs go to the provider as binary documents and are not redacted; names and postal
 * addresses are not detected. Tenants can turn AI off entirely (TenantAiPolicy.enabled).
 */

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const IBAN = /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?\b/g;
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
// +44 20 7946 0958, (555) 123-4567, 555-123-4567, +91 98765 43210
const PHONE = /(?<![\w.])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}[\s.-]\d{3,4}[\s.-]?\d{3,4}(?![\w.])/g;

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export interface Redacted {
  text: string;
  count: number;
}

export function redactPii(input: string): Redacted {
  let count = 0;
  let text = input.replace(EMAIL, () => {
    count++;
    return '[EMAIL]';
  });
  text = text.replace(IBAN, (m) => {
    count++;
    return m.length >= 15 ? '[IBAN]' : m;
  });
  text = text.replace(CARD, (m) => {
    const digits = m.replace(/\D/g, '');
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits)) {
      count++;
      return '[CARD]';
    }
    return m;
  });
  text = text.replace(PHONE, (m) => {
    if (m.replace(/\D/g, '').length < 9) return m;
    count++;
    return '[PHONE]';
  });
  return { text, count };
}
