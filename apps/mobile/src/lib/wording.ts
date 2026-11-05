import type { Definition, Question } from './types';

/** Replace one question's text and option labels inside a copy of the definition. */
export function withWording(def: Definition, questionId: string, text: string, labels: Record<number, string>): Definition {
  return {
    ...def,
    pages: def.pages.map((p) => ({
      ...p,
      questions: p.questions.map(
        (qq): Question =>
          qq.id !== questionId
            ? qq
            : { ...qq, text, ...(qq.options ? { options: qq.options.map((o) => ({ ...o, label: labels[o.code] ?? o.label })) } : {}) },
      ),
    })),
  };
}
