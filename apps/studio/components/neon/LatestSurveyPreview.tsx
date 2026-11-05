'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  defaultPresentation,
  parsePresentation,
  parseSurveyDefinition,
  type Presentation,
  type SurveyDefinition,
} from '@zapx/survey-schema';
import { api } from '@/lib/api';
import { Preview } from '@/components/Preview';

/**
 * Live preview of the most recently edited survey's current draft, run in the browser with the same
 * logic engine as respondents get (nothing is recorded). Shows nothing to preview until a survey exists.
 */
export function LatestSurveyPreview({ survey }: { survey: { id: string; name: string } | null }) {
  const [state, setState] = useState<{ def: SurveyDefinition; pres: Presentation } | 'invalid' | null>(null);

  useEffect(() => {
    setState(null);
    if (!survey) return;
    void api<{ version: { definition: unknown; presentation: unknown } }>(`/surveys/${survey.id}/draft`).then(
      ({ version }) => {
        const d = parseSurveyDefinition(version.definition);
        if (!d.ok) return setState('invalid');
        const p = parsePresentation(version.presentation);
        setState({ def: d.definition, pres: p.ok ? p.presentation : defaultPresentation() });
      },
      () => setState('invalid'),
    );
  }, [survey]);

  return (
    <section className="panel nx-card nx-live-preview" aria-labelledby="preview-title">
      <div className="nx-card-head">
        <h2 id="preview-title">
          <Eye size={17} aria-hidden="true" /> Survey preview <span className="muted small">(live draft)</span>
        </h2>
      </div>
      {!survey ? (
        <p className="muted small">Your latest survey appears here, ready to click through on desktop, tablet or phone.</p>
      ) : state === null ? (
        <div className="nx-skeleton" style={{ height: 260 }} />
      ) : state === 'invalid' ? (
        <p className="muted small">
          <Link href={`/surveys/${survey.id}`}>{survey.name}</Link> has errors to fix before it can be previewed.
        </p>
      ) : (
        <>
          <p className="small muted" style={{ margin: '0 0 8px' }}>
            <Link href={`/surveys/${survey.id}?tab=preview`}>{survey.name}</Link> · nothing is recorded
          </p>
          <Preview key={survey.id} def={state.def} presentation={state.pres} compact />
        </>
      )}
    </section>
  );
}
