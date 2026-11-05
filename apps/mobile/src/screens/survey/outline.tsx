import { useState } from 'react';
import { View } from 'react-native';
import { useEntitlements } from '@/lib/entitlements-context';
import { Async, Button, Card, ErrorNote, Field, H2, Pill, Section, T } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { DraftAnswer, Question } from '@/lib/types';
import { withWording } from '@/lib/wording';

/**
 * The questionnaire, page by page. With "Edit surveys" in the plan a programmer can change question
 * wording and option labels on the draft (codes, logic and structure stay as they are; the web studio
 * is the place for structural changes). Saving sends the whole draft with its updatedAt, so a
 * conflicting edit from someone else is refused instead of overwritten.
 */
export function Outline({ surveyId }: { surveyId: string }) {
  const q = useApi<DraftAnswer>(`/surveys/${surveyId}/draft`);
  const { has } = useEntitlements();
  const { member } = useSession();
  const canEdit = has('surveys.edit') && (member?.role === 'ADMIN' || member?.role === 'PROGRAMMER');
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Async q={q}>
        {(d) => (
          <>
            <T muted>
              {d.version.status === 'DRAFT'
                ? `Draft v${d.version.version}`
                : `Version ${d.version.version} (${d.version.status.toLowerCase()})`}{' '}
              · {d.version.definition.pages.reduce((n, p) => n + p.questions.length, 0)} questions
            </T>
            {d.version.definition.pages.map((page, pi) => (
              <View key={page.id} style={{ gap: 10 }}>
                <H2>{page.title || `Page ${pi + 1}`}</H2>
                {page.questions.map((question) =>
                  editing === question.id ? (
                    <EditQuestion
                      key={question.id}
                      surveyId={surveyId}
                      draft={d}
                      question={question}
                      onDone={() => {
                        setEditing(null);
                        void q.reload();
                      }}
                    />
                  ) : (
                    <Card key={question.id}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                        <T bold style={{ flex: 1 }}>
                          {question.id}. {question.text}
                        </T>
                        <Pill label={question.type} tone="accent3" />
                      </View>
                      {question.options?.map((o) => (
                        <T key={o.code} muted>
                          {o.code}. {o.label}
                        </T>
                      ))}
                      {canEdit ? (
                        <Button small kind="ghost" icon="create-outline" title="Edit wording" onPress={() => setEditing(question.id)} />
                      ) : null}
                    </Card>
                  ),
                )}
              </View>
            ))}
          </>
        )}
      </Async>
    </Section>
  );
}

function EditQuestion({
  surveyId,
  draft,
  question,
  onDone,
}: {
  surveyId: string;
  draft: DraftAnswer;
  question: Question;
  onDone: () => void;
}) {
  const { api } = useSession();
  const [text, setText] = useState(question.text);
  const [labels, setLabels] = useState<Record<number, string>>(Object.fromEntries((question.options ?? []).map((o) => [o.code, o.label])));
  const a = useAction();
  const save = () =>
    a.run(async () => {
      // Make sure a draft exists (GET /draft creates one from the published version).
      const fresh = await api.get<DraftAnswer>(`/surveys/${surveyId}/draft`);
      const definition = withWording(fresh.version.definition, question.id, text.trim(), labels);
      await api.put(`/surveys/${surveyId}/draft`, { definition, expectedUpdatedAt: fresh.version.updatedAt ?? draft.version.updatedAt });
      onDone();
    });
  const blank = !text.trim() || Object.values(labels).some((l) => !l.trim());
  return (
    <Card glow>
      <Field label={`Question ${question.id}`} value={text} onChangeText={setText} multiline />
      {(question.options ?? []).map((o) => (
        <Field
          key={o.code}
          label={`Option ${o.code}`}
          value={labels[o.code]}
          onChangeText={(v) => setLabels((l) => ({ ...l, [o.code]: v }))}
        />
      ))}
      {a.error ? <ErrorNote message={a.error} /> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title="Save to draft" icon="save-outline" onPress={() => void save()} busy={a.busy} disabled={blank} />
        <Button title="Cancel" kind="secondary" onPress={onDone} />
      </View>
    </Card>
  );
}
