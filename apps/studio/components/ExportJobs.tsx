'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, jobDone, type Job } from '@/lib/api';
import { ErrorNote } from './Shell';

interface ExportResult {
  fileId: string;
  name: string;
  size: number;
  rows: number;
  format: 'csv' | 'xlsx';
  expiresAt: string;
}

const STATUS_LABEL: Record<Job['status'], string> = {
  QUEUED: 'waiting',
  RUNNING: 'running',
  SUCCEEDED: 'ready',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

function size(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** A progress bar plus the worker's note, for any running job. */
export function JobProgress({ job }: { job: Job<unknown> }) {
  return (
    <div className="job-progress" data-testid="job-progress">
      <div className="bar" role="progressbar" aria-valuenow={job.progress} aria-valuemin={0} aria-valuemax={100}>
        <div style={{ width: `${Math.max(2, job.progress)}%` }} />
      </div>
      <span className="small muted">
        {job.status === 'QUEUED' ? 'Waiting for a worker…' : (job.progressNote ?? 'Working…')}
        {job.cancelRequested ? ' (stopping)' : ''}
      </span>
    </div>
  );
}

/**
 * Background exports: the file is built by the job worker and kept for a limited time, so large
 * response sets do not hold a browser request open. Downloads are checked and audited per file.
 */
export function ExportJobs({ surveyId, includeTest }: { surveyId: string; includeTest: boolean }) {
  const [jobs, setJobs] = useState<Array<Job<ExportResult>>>([]);
  const [error, setError] = useState<unknown>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const list = await api<Array<Job<ExportResult>>>(`/surveys/${surveyId}/jobs?type=export`);
      setJobs(list.slice(0, 5));
      if (timer.current) clearTimeout(timer.current);
      if (list.some((j) => !jobDone(j))) timer.current = setTimeout(() => void load(), 1000);
    } catch (e) {
      setError(e);
    }
  }, [surveyId]);
  useEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [load]);

  const start = async (format: 'csv' | 'xlsx') => {
    setError(null);
    try {
      await api(`/surveys/${surveyId}/jobs/export`, { method: 'POST', body: { format, includeTest } });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const cancel = async (id: string) => {
    setError(null);
    try {
      await api(`/jobs/${id}/cancel`, { method: 'POST' });
      await load();
    } catch (e) {
      setError(e);
    }
  };

  const expired = (j: Job<ExportResult>) => !!j.result && new Date(j.result.expiresAt).getTime() < Date.now();

  return (
    <div className="stack" data-testid="export-jobs" style={{ marginTop: 8 }}>
      <div className="row">
        <span className="small muted">Large exports run in the background and stay available to download for a few days.</span>
        <div style={{ flex: 1 }} />
        <button onClick={() => start('csv')}>Background CSV</button>
        <button onClick={() => start('xlsx')}>Background Excel</button>
      </div>
      <ErrorNote error={error} />
      {jobs.length ? (
        <table className="data">
          <thead>
            <tr>
              <th>Started</th>
              <th>Status</th>
              <th>File</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id} data-testid="export-job">
                <td className="small">{new Date(j.createdAt).toLocaleString()}</td>
                <td>
                  <span className={`badge ${j.status === 'FAILED' ? 'bad' : j.status === 'SUCCEEDED' ? 'good' : ''}`}>
                    {STATUS_LABEL[j.status]}
                  </span>
                  {j.status === 'FAILED' && j.error ? <div className="small error-text">{j.error}</div> : null}
                </td>
                <td>
                  {!jobDone(j) ? (
                    <JobProgress job={j} />
                  ) : j.result ? (
                    <span className="small">
                      {j.result.name} · {j.result.rows} rows · {size(j.result.size)}
                    </span>
                  ) : null}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {j.status === 'SUCCEEDED' && j.result ? (
                    expired(j) ? (
                      <span className="small muted">expired</span>
                    ) : (
                      <a className="btn" href={`/api/files/${j.result.fileId}`} download>
                        Download
                      </a>
                    )
                  ) : null}
                  {!jobDone(j) && !j.cancelRequested ? <button onClick={() => cancel(j.id)}>Cancel</button> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
