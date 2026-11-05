import { useState } from 'react';
import { View } from 'react-native';
import { Async, Button, Card, ErrorNote, Field, H2, KV, List, Pill, Row, Section, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

interface Summary {
  id: string;
  title: string;
  source: string;
  status: 'PROPOSED' | 'APPLIED' | 'REJECTED';
  createdAt: string;
}
interface ChangeSet extends Summary {
  prompt: string | null;
  diff: {
    items: Array<{ change: string; entity: string; id: string; summary: string }>;
    counts: { added: number; removed: number; changed: number; moved: number };
    affectsData: boolean;
  };
  assumptions: string[];
  check: { publishable: boolean; qa: { passed: boolean; coverage: { percent: number } } | null };
  stale: boolean;
}

/**
 * AI assist: describe a change in plain words; the AI proposes a change set that a person reviews
 * and applies (never applied automatically). Needs the AI key set by the super admin.
 */
export function Assist({ surveyId }: { surveyId: string }) {
  const { api, member } = useSession();
  const list = useApi<Summary[]>(`/surveys/${surveyId}/changesets`);
  const status = useApi<{ configured?: boolean; available?: boolean }>('/ai/status');
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState<ChangeSet | null>(null);
  const a = useAction();
  const canEdit = member?.role === 'ADMIN' || member?.role === 'PROGRAMMER';
  const propose = () =>
    a.run(async () => {
      const cs = await api.post<ChangeSet | { changeSet: ChangeSet }>(`/surveys/${surveyId}/ai/propose`, { instruction: prompt.trim() });
      setOpen('changeSet' in cs ? cs.changeSet : cs);
      setPrompt('');
      await list.reload();
    });
  const show = (id: string) => a.run(async () => setOpen(await api.get<ChangeSet>(`/changesets/${id}`)));
  const decide = (verb: 'apply' | 'reject') =>
    a.run(async () => {
      if (!open) return;
      await api.post(`/changesets/${open.id}/${verb}`);
      setOpen(await api.get<ChangeSet>(`/changesets/${open.id}`));
      await list.reload();
    });
  const ready = status.data?.configured ?? status.data?.available ?? true;
  return (
    <Section refreshing={list.loading} onRefresh={list.reload}>
      {canEdit ? (
        <Card glow>
          <Field
            label="Describe a change"
            value={prompt}
            onChangeText={setPrompt}
            multiline
            placeholder="Add an age question with 18-24, 25-34, 35-44, 45+ and terminate under 18"
          />
          {!ready ? <T muted>AI is not set up yet. The super admin adds the Claude key under Integrations.</T> : null}
          <Button
            title="Propose change"
            icon="sparkles-outline"
            onPress={() => void propose()}
            busy={a.busy}
            disabled={!prompt.trim() || !ready}
          />
        </Card>
      ) : null}
      {a.error ? <ErrorNote message={a.error} /> : null}
      {open ? (
        <Card glow>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T bold style={{ flex: 1 }}>
              {open.title}
            </T>
            <Pill label={open.status} />
          </View>
          <KV
            k="Changes"
            v={`${open.diff.counts.added} added · ${open.diff.counts.changed} changed · ${open.diff.counts.removed} removed`}
          />
          {open.diff.affectsData ? <T style={{ fontWeight: '700' }}>Warning: this changes stored data (ids or answer codes).</T> : null}
          {open.check.qa ? (
            <KV k="Automatic QA" v={`${open.check.qa.passed ? 'passed' : 'failed'} · ${open.check.qa.coverage.percent}% coverage`} />
          ) : null}
          {open.diff.items.slice(0, 30).map((d, i) => (
            <T key={i} size={13}>
              • {d.summary}
            </T>
          ))}
          {open.assumptions.map((s, i) => (
            <T key={i} muted size={12}>
              Assumed: {s}
            </T>
          ))}
          {open.stale ? <T muted>The draft changed after this proposal; ask again for a fresh one.</T> : null}
          {open.status === 'PROPOSED' && canEdit ? (
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button
                small
                title="Apply to draft"
                icon="checkmark"
                onPress={() => void decide('apply')}
                disabled={open.stale}
                busy={a.busy}
              />
              <Button small kind="secondary" title="Reject" onPress={() => void decide('reject')} />
            </View>
          ) : null}
        </Card>
      ) : null}
      <H2>Proposals</H2>
      <Async q={list}>
        {(items) => (
          <List
            items={items}
            empty="No proposals yet."
            render={(c) => (
              <Row
                title={c.title}
                subtitle={`${c.source.toLowerCase()} · ${when(c.createdAt)}`}
                right={<Pill label={c.status} />}
                onPress={() => void show(c.id)}
              />
            )}
          />
        )}
      </Async>
    </Section>
  );
}
