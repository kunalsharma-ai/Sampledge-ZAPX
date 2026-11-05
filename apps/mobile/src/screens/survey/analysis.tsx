import { useState } from 'react';
import { View } from 'react-native';
import { Async, Bar, Button, Card, Empty, ErrorNote, H2, Section, Segmented, T } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import { usePalette } from '@/lib/theme';
import type { Frequency } from '@/lib/types';

interface Variables {
  completes: number;
  variables: Array<{ id: string; label: string; kind: string; source: string }>;
}
interface CrossResult {
  total: number;
  tables: Array<{
    banner: { label: string };
    stub: { label: string };
    columns: Array<{ key: string; label: string; letter: string; base: number; lowBase: boolean }>;
    rows: Array<{ code: string | number; label: string; cells: Array<{ pct: number; higherThan: string[] }> }>;
    testNote: string | null;
  }>;
}

const FILTERS = { statuses: ['COMPLETE'], includeTest: false, includeRejected: false };

/** Frequencies of every question and a crosstab of one question by another, on completes. */
export function Analysis({ surveyId }: { surveyId: string }) {
  const [mode, setMode] = useState<'freq' | 'cross'>('freq');
  const vars = useApi<Variables>(`/surveys/${surveyId}/analysis/variables`);
  return (
    <Section refreshing={vars.loading} onRefresh={vars.reload}>
      <Segmented
        value={mode}
        onChange={setMode}
        options={[
          { key: 'freq', label: 'Frequencies' },
          { key: 'cross', label: 'Crosstab' },
        ]}
      />
      <Async q={vars}>
        {(v) =>
          mode === 'freq' ? (
            <Frequencies surveyId={surveyId} completes={v.completes} />
          ) : (
            <CrossTab surveyId={surveyId} vars={v.variables} />
          )
        }
      </Async>
    </Section>
  );
}

function Frequencies({ surveyId, completes }: { surveyId: string; completes: number }) {
  const { api } = useSession();
  const [data, setData] = useState<{ total: number; frequencies: Frequency[] } | null>(null);
  const a = useAction();
  const run = () => a.run(async () => setData(await api.post(`/surveys/${surveyId}/analysis/frequencies`, { filters: FILTERS })));
  if (!completes) return <Empty text="No completes to analyse yet." icon="bar-chart-outline" />;
  return (
    <>
      {!data ? (
        <Button
          title={`Run frequencies on ${completes.toLocaleString()} completes`}
          icon="bar-chart-outline"
          onPress={() => void run()}
          busy={a.busy}
          testID="run-frequencies"
        />
      ) : null}
      {a.error ? <ErrorNote message={a.error} /> : null}
      {data?.frequencies.map((f) => <FrequencyCard key={f.variable.id} f={f} />)}
    </>
  );
}

export function FrequencyCard({ f }: { f: Frequency }) {
  const p = usePalette();
  const max = Math.max(1, ...f.rows.map((r) => r.pct));
  return (
    <Card>
      <T bold>{f.variable.label}</T>
      <T muted size={12}>
        Base {Math.round(f.base).toLocaleString()}
        {f.stats?.mean !== undefined ? ` · mean ${f.stats.mean.toFixed(2)}` : ''}
        {f.nps ? ` · NPS ${f.nps.score}` : ''}
      </T>
      {f.rows.map((r, i) => (
        <Bar
          key={String(r.code)}
          label={`${r.label} · ${r.pct.toFixed(1)}%`}
          value={Math.round(r.count)}
          max={(max / 100) * f.base || 1}
          color={p.viz[i % 4]}
        />
      ))}
      {f.samples?.slice(0, 5).map((s, i) => (
        <T key={i} muted size={13}>
          “{s}”
        </T>
      ))}
    </Card>
  );
}

function CrossTab({ surveyId, vars }: { surveyId: string; vars: Variables['variables'] }) {
  const { api } = useSession();
  const p = usePalette();
  const banners = vars.filter((v) => ['single', 'multi', 'scale'].includes(v.kind));
  const [banner, setBanner] = useState(banners[0]?.id ?? '');
  const [stub, setStub] = useState(banners[1]?.id ?? banners[0]?.id ?? '');
  const [data, setData] = useState<CrossResult | null>(null);
  const a = useAction();
  if (banners.length < 1) return <Empty text="This survey has no choice questions to cross." />;
  const run = () =>
    a.run(async () =>
      setData(await api.post(`/surveys/${surveyId}/analysis/crosstab`, { filters: FILTERS, banner, stubs: [stub], confidence: 0.95 })),
    );
  return (
    <>
      <H2>Columns (banner)</H2>
      <Segmented value={banner} onChange={setBanner} options={banners.map((v) => ({ key: v.id, label: v.id }))} />
      <H2>Rows</H2>
      <Segmented value={stub} onChange={setStub} options={vars.map((v) => ({ key: v.id, label: v.id }))} />
      <Button title="Run crosstab" icon="grid-outline" onPress={() => void run()} busy={a.busy} />
      {a.error ? <ErrorNote message={a.error} /> : null}
      {data?.tables.map((t, ti) => (
        <Card key={ti}>
          <T bold>
            {t.stub.label} by {t.banner.label}
          </T>
          {t.testNote ? (
            <T muted size={12}>
              {t.testNote}
            </T>
          ) : (
            <T muted size={12}>
              Letters: significantly higher than that column (95%).
            </T>
          )}
          {t.rows.map((r) => (
            <View key={String(r.code)} style={{ gap: 4, paddingVertical: 4 }}>
              <T bold size={13}>
                {r.label}
              </T>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                {r.cells.map((c, i) => (
                  <T key={i} size={12} style={{ color: i === 0 ? p.text : p.muted }}>
                    {t.columns[i]?.label} ({t.columns[i]?.letter}): {c.pct.toFixed(0)}%
                    {c.higherThan.length ? ` ${c.higherThan.join('')}` : ''}
                  </T>
                ))}
              </View>
            </View>
          ))}
        </Card>
      ))}
    </>
  );
}
