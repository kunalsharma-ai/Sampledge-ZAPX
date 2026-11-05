import { useState } from 'react';
import { Stack } from 'expo-router';
import { Gate } from '@/components/gate';
import { Async, Field, List, Pill, Row, Screen, Segmented } from '@/components/ui';
import { useApi } from '@/lib/use-api';

interface Item {
  id: string;
  kind: 'QUESTION' | 'SURVEY' | 'BLOCK';
  name: string;
  category: string;
  tags: string[];
}

/** Question bank: questions, blocks and survey templates the organization has saved. */
export default function Library() {
  return (
    <>
      <Stack.Screen options={{ title: 'Question bank' }} />
      <Gate feature="library">
        <LibraryBody />
      </Gate>
    </>
  );
}

function LibraryBody() {
  const [kind, setKind] = useState<'' | Item['kind']>('');
  const [text, setText] = useState('');
  const qs = new URLSearchParams({ ...(kind ? { kind } : {}), ...(text.trim() ? { q: text.trim() } : {}) }).toString();
  const q = useApi<Item[]>(`/library${qs ? `?${qs}` : ''}`);
  return (
    <Screen refreshing={q.loading} onRefresh={q.reload}>
      <Field label="Search" value={text} onChangeText={setText} placeholder="Name, category or tag" />
      <Segmented
        value={kind}
        onChange={setKind}
        options={[
          { key: '', label: 'All' },
          { key: 'QUESTION', label: 'Questions' },
          { key: 'BLOCK', label: 'Blocks' },
          { key: 'SURVEY', label: 'Surveys' },
        ]}
      />
      <Async q={q}>
        {(items) => (
          <List
            items={items}
            empty="Nothing saved yet. Save questions to the bank from the survey editor on the web."
            render={(it) => (
              <Row
                title={it.name}
                subtitle={`${it.category}${it.tags.length ? ` · ${it.tags.join(', ')}` : ''}`}
                right={<Pill label={it.kind} tone="accent3" />}
              />
            )}
          />
        )}
      </Async>
    </Screen>
  );
}
