import { useState } from 'react';
import { View } from 'react-native';
import { Async, Button, Card, Empty, ErrorNote, Field, Pill, Section, Segmented, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';

type Filter = 'pending' | 'flagged' | 'accepted' | 'rejected';
interface Item {
  id: string;
  uid: string;
  status: string;
  mode: string;
  qualityScore: number | null;
  qualityFlags: Array<{ code: string; detail: string; penalty: number }>;
  reviewState: string;
  reviewNote: string | null;
  durationMs: number | null;
  completedAt: string | null;
  vendor: { code: string } | null;
  interviewer: { name: string } | null;
  openEnds: Array<{ questionId: string; text: string }>;
}

export function Review({ surveyId }: { surveyId: string }) {
  const [filter, setFilter] = useState<Filter>('pending');
  const q = useApi<{ counts: Record<string, number>; items: Item[] }>(`/surveys/${surveyId}/quality?filter=${filter}&take=50`);
  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { key: 'pending', label: `Pending${q.data?.counts.pending ? ` ${q.data.counts.pending}` : ''}` },
          { key: 'flagged', label: 'Flagged' },
          { key: 'accepted', label: 'Accepted' },
          { key: 'rejected', label: 'Rejected' },
        ]}
      />
      <Async q={q}>
        {(d) =>
          d.items.length ? (
            d.items.map((it) => <ReviewCard key={it.id} surveyId={surveyId} item={it} onDone={q.reload} />)
          ) : (
            <Empty text="Nothing here." icon="checkmark-done-outline" />
          )
        }
      </Async>
    </Section>
  );
}

function ReviewCard({ surveyId, item, onDone }: { surveyId: string; item: Item; onDone: () => void }) {
  const { api } = useSession();
  const [note, setNote] = useState('');
  const a = useAction();
  const decide = (decision: 'accept' | 'reject') =>
    a.run(async () => {
      await api.post(`/surveys/${surveyId}/quality/decisions`, {
        responseIds: [item.id],
        decision,
        ...(note.trim() ? { note: note.trim() } : {}),
      });
      onDone();
    });
  const pending = item.reviewState === 'PENDING';
  return (
    <Card>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T bold>{item.uid}</T>
        <Pill label={item.reviewState === 'NONE' ? item.status : item.reviewState} />
      </View>
      <T muted size={12}>
        {item.mode.toLowerCase()}
        {item.vendor ? ` · ${item.vendor.code}` : ''}
        {item.interviewer ? ` · ${item.interviewer.name}` : ''} · {when(item.completedAt)}
        {item.durationMs !== null ? ` · ${Math.round(item.durationMs / 60000)} min` : ''}
      </T>
      <T>Quality score {item.qualityScore ?? '—'}</T>
      {item.qualityFlags.map((f, i) => (
        <T key={i} muted size={13}>
          • {f.detail} (−{f.penalty})
        </T>
      ))}
      {item.openEnds.slice(0, 3).map((o) => (
        <T key={o.questionId} size={13}>
          {o.questionId}: “{o.text}”
        </T>
      ))}
      {item.reviewNote ? <T muted>Note: {item.reviewNote}</T> : null}
      {pending ? (
        <>
          <Field label="Note (optional)" value={note} onChangeText={setNote} />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button small title="Accept" icon="checkmark" onPress={() => void decide('accept')} busy={a.busy} />
            <Button small kind="danger" title="Reject" icon="close" onPress={() => void decide('reject')} disabled={a.busy} />
          </View>
        </>
      ) : null}
      {a.error ? <ErrorNote message={a.error} /> : null}
    </Card>
  );
}
