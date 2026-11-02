'use client';
/**
 * Survey media (Milestone 11): upload images, video and audio, then pick them for questions and
 * answer options. Files are served to respondents from /api/public/media/:id.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { MediaKind, QuestionMedia } from '@zapx/survey-schema';
import { api, upload } from '@/lib/api';
import { ErrorNote } from './Shell';

export interface MediaFile {
  id: string;
  kind: MediaKind;
  name: string;
  contentType: string;
  size: number;
  url: string;
}

interface Library {
  surveyId: string;
  files: MediaFile[];
  readOnly: boolean;
  refresh: () => Promise<void>;
  add: (f: MediaFile) => void;
}
const LibraryContext = createContext<Library | null>(null);

/** Loads a survey's media once for every picker inside it. */
export function MediaLibraryProvider({ surveyId, readOnly, children }: { surveyId: string; readOnly: boolean; children: React.ReactNode }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const refresh = useCallback(async () => setFiles(await api<MediaFile[]>(`/surveys/${surveyId}/media`)), [surveyId]);
  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);
  return (
    <LibraryContext.Provider value={{ surveyId, files, readOnly, refresh, add: (f) => setFiles((x) => [f, ...x]) }}>
      {children}
    </LibraryContext.Provider>
  );
}

export const mediaSrc = (id: string) => `/api/public/media/${encodeURIComponent(id)}`;

function sizeOf(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

const ACCEPT: Record<MediaKind | 'any', string> = {
  image: 'image/png,image/jpeg,image/webp,image/gif',
  video: 'video/mp4,video/webm',
  audio: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm,.m4a,.mp3',
  any: 'image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,audio/mpeg,audio/mp4,audio/ogg,audio/wav,.m4a,.mp3',
};

function UploadButton({ kind, onUploaded, label }: { kind: MediaKind | 'any'; onUploaded: (f: MediaFile) => void; label: string }) {
  const lib = useContext(LibraryContext)!;
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  return (
    <span className="row" style={{ gap: 6 }}>
      <input
        ref={input}
        type="file"
        accept={ACCEPT[kind]}
        hidden
        aria-label={`${label} (file)`}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError(null);
          try {
            const form = new FormData();
            form.append('file', file);
            const f = await upload<MediaFile>(`/surveys/${lib.surveyId}/media`, form);
            lib.add(f);
            onUploaded(f);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      />
      <button type="button" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? 'Uploading…' : label}
      </button>
      <ErrorNote error={error} />
    </span>
  );
}

/** Thumbnail or player for a media file in the studio. */
export function MediaThumb({ kind, id, alt }: { kind: MediaKind; id: string; alt?: string }) {
  if (kind === 'image') return <img className="media-thumb" src={mediaSrc(id)} alt={alt ?? ''} />;
  if (kind === 'video') return <video className="media-thumb" src={mediaSrc(id)} controls preload="metadata" />;
  return <audio src={mediaSrc(id)} controls preload="metadata" />;
}

/** Media shown with a question: choose or upload, then describe it. */
export function QuestionMediaEditor({
  media,
  onChange,
}: {
  media: QuestionMedia | undefined;
  onChange: (m: QuestionMedia | undefined) => void;
}) {
  const lib = useContext(LibraryContext);
  if (!lib) return null;
  const pick = (f: MediaFile) =>
    onChange({ kind: f.kind, id: f.id, alt: media?.alt ?? '', caption: media?.caption, requireComplete: media?.requireComplete ?? false });
  return (
    <section className="media-editor stack" aria-label="Media">
      <h3>Image, video or audio</h3>
      {media ? (
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <MediaThumb kind={media.kind} id={media.id} alt={media.alt} />
          <div className="stack" style={{ flex: 1, minWidth: 220 }}>
            <label className="field">
              {media.kind === 'image' ? 'Describe the image (for screen readers)' : 'Describe the clip (for screen readers)'}
              <input value={media.alt} maxLength={300} onChange={(e) => onChange({ ...media, alt: e.target.value })} />
            </label>
            <label className="field">
              Caption (optional, shown under it)
              <input
                value={media.caption ?? ''}
                maxLength={500}
                onChange={(e) => onChange({ ...media, caption: e.target.value || undefined })}
              />
            </label>
            {media.kind !== 'image' ? (
              <label className="check">
                <input
                  type="checkbox"
                  checked={media.requireComplete}
                  onChange={(e) => onChange({ ...media, requireComplete: e.target.checked })}
                />
                Respondents must play it to the end before continuing
              </label>
            ) : null}
            <div>
              <button type="button" className="link danger" onClick={() => onChange(undefined)}>
                Remove from question
              </button>
            </div>
          </div>
        </div>
      ) : (
        <p className="muted small">Show an ad, a concept board, a pack shot or an audio clip above the answers.</p>
      )}
      {!lib.readOnly ? (
        <div className="row">
          <UploadButton kind="any" label={media ? 'Replace with a new file' : 'Upload a file'} onUploaded={pick} />
          {lib.files.length ? (
            <label className="field" style={{ minWidth: 220 }}>
              Or use an uploaded file
              <select
                value=""
                onChange={(e) => {
                  const f = lib.files.find((x) => x.id === e.target.value);
                  if (f) pick(f);
                }}
              >
                <option value="">Choose…</option>
                {lib.files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.kind}: {f.name} ({sizeOf(f.size)})
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}
      <p className="muted small">Images up to 10 MB (PNG, JPEG, WebP, GIF), audio up to 25 MB (MP3, M4A, OGG, WAV), video MP4 or WebM.</p>
    </section>
  );
}

/** Picture for an answer option (image choice). */
export function OptionImagePicker({
  image,
  label,
  onChange,
}: {
  image: string | undefined;
  label: string;
  onChange: (id: string | undefined) => void;
}) {
  const lib = useContext(LibraryContext);
  if (!lib) return null;
  const images = lib.files.filter((f) => f.kind === 'image');
  return (
    <span className="row option-image" style={{ gap: 6, flexWrap: 'nowrap' }}>
      {image ? <img className="option-thumb" src={mediaSrc(image)} alt="" /> : null}
      {!lib.readOnly ? (
        <>
          <select aria-label={`Picture for ${label}`} value={image ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
            <option value="">No picture</option>
            {images.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <UploadButton kind="image" label="Upload" onUploaded={(f) => onChange(f.id)} />
        </>
      ) : null}
    </span>
  );
}

/** Whether pickers are available (inside a MediaLibraryProvider). */
export function useHasMediaLibrary() {
  return !!useContext(LibraryContext);
}
