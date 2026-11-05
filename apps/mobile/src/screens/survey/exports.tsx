import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Async, Button, Card, ErrorNote, List, Pill, Row, Section, Segmented, T, when } from '@/components/ui';
import { useAction, useApi } from '@/lib/use-api';
import { useSession } from '@/lib/session';
import type { Job } from '@/lib/types';

/** Exports run as background jobs; finished files are downloaded with the session and shared. */
export function Exports({ surveyId }: { surveyId: string }) {
  const q = useApi<Job[]>(`/surveys/${surveyId}/jobs`);
  const { api } = useSession();
  const [format, setFormat] = useState<'xlsx' | 'csv'>('xlsx');
  const a = useAction();
  const running = q.data?.some((j) => j.status === 'QUEUED' || j.status === 'RUNNING');
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => void q.reload(), 3000);
    return () => clearInterval(t);
  }, [running, q]);

  const start = () =>
    a.run(async () => {
      await api.post(`/surveys/${surveyId}/jobs/export`, { format, statuses: ['COMPLETE'] });
      await q.reload();
    });

  const download = (j: Job) =>
    a.run(async () => {
      const fileId = j.result?.fileId;
      if (!fileId) return;
      const url = `${api.baseUrl}/files/${fileId}`;
      if (Platform.OS === 'web') {
        const res = await fetch(url, { headers: api.headers() });
        const blob = await res.blob();
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = j.result?.name ?? 'export';
        link.click();
        return;
      }
      const target = new File(Paths.cache, j.result?.name ?? `export-${fileId}`);
      if (target.exists) target.delete();
      const file = await File.downloadFileAsync(url, target, { headers: api.headers() });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
    });

  return (
    <Section refreshing={q.loading} onRefresh={q.reload}>
      <Card glow>
        <T>Export completes to a file. Large exports run in the background; you can leave this screen.</T>
        <Segmented
          value={format}
          onChange={setFormat}
          options={[
            { key: 'xlsx', label: 'Excel' },
            { key: 'csv', label: 'CSV' },
          ]}
        />
        <Button title="Start export" icon="download-outline" onPress={() => void start()} busy={a.busy} />
        {a.error ? <ErrorNote message={a.error} /> : null}
      </Card>
      <Async q={q}>
        {(jobs) => (
          <List
            items={jobs}
            empty="No jobs yet."
            render={(j) => (
              <Row
                title={`${j.type.toLowerCase()}${j.result?.name ? ` · ${j.result.name}` : ''}`}
                subtitle={`${when(j.createdAt)}${j.result?.rows !== undefined ? ` · ${j.result.rows} rows` : ''}${j.error ? ` · ${j.error}` : ''}${j.progressNote ? ` · ${j.progressNote}` : ''}`}
                right={<Pill label={j.status} />}
                onPress={j.status === 'SUCCEEDED' && j.result?.fileId ? () => void download(j) : undefined}
              />
            )}
          />
        )}
      </Async>
    </Section>
  );
}
