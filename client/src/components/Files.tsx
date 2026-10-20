import { lazy, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, ImagePlus, LocateFixed, MapPin, Trash2, Upload, X } from 'lucide-react';
import { api, fileUrl } from '../lib/api';
import { fmtDateTime, fmtSize, humanize } from '../lib/format';
import { useAuth } from '../lib/auth';
import { Button, Checkbox, Empty, Input, Modal, Select, cx, useConfirm, useToast } from './ui';

export interface FileRow {
  id: string; originalName: string; mimeType: string; size: number; kind: 'PHOTO' | 'DOCUMENT'; category: string; caption: string | null; takenAt: string | null;
  latitude: number | null; longitude: number | null; locationSource: string; exifTakenAt: string | null; createdAt: string; uploadedBy: { id: string; name: string };
}

const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';
const DOC_ACCEPT = 'application/pdf,.pdf,.docx,.xlsx,.pptx,image/jpeg,image/png,image/webp';
const PDFIMG_ACCEPT = 'application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png';

export const LOCATION_LABEL: Record<string, string> = {
  EXIF: 'GPS read from photo metadata (EXIF) — not independently verified',
  DEVICE: 'Device location captured at upload (with permission)',
  MANUAL: 'Coordinates entered manually',
  NONE: 'No location',
};

/**
 * Drag-and-drop uploader. `kind` decides accepted types; client-side checks mirror the server,
 * which re-validates by file content.
 */
export function Uploader({
  target, entityId, categories, kind = 'photo', onUploaded, withGeo, compact, withDescription,
}: {
  target: string; entityId: string; categories: { value: string; label: string }[]; kind?: 'photo' | 'doc' | 'pdfimage'; onUploaded: () => void; withGeo?: boolean; compact?: boolean; withDescription?: boolean;
}) {
  const { settings } = useAuth();
  const maxMb = settings?.maxUploadMb ?? 10;
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState(categories[0]?.value ?? 'GENERAL');
  const [caption, setCaption] = useState('');
  const [description, setDescription] = useState('');
  const [takenAt, setTakenAt] = useState('');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [geoSource, setGeoSource] = useState<'MANUAL' | 'DEVICE'>('MANUAL');
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [useGeo, setUseGeo] = useState(false);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const accept = kind === 'photo' ? PHOTO_ACCEPT : kind === 'pdfimage' ? PDFIMG_ACCEPT : DOC_ACCEPT;

  const validExt = (f: File) => {
    const ext = f.name.toLowerCase().split('.').pop() ?? '';
    const allowed = kind === 'photo' ? ['jpg', 'jpeg', 'png', 'webp'] : kind === 'pdfimage' ? ['pdf', 'jpg', 'jpeg', 'png'] : ['pdf', 'docx', 'xlsx', 'pptx', 'jpg', 'jpeg', 'png', 'webp'];
    return allowed.includes(ext);
  };
  const add = (list: FileList | File[]) => {
    const arr = Array.from(list);
    const bad = arr.filter((f) => !validExt(f) || f.size > maxMb * 1024 * 1024);
    setErr(bad.length ? `${bad.map((b) => b.name).join(', ')}: not allowed or larger than ${maxMb} MB.` : null);
    setFiles((prev) => [...prev, ...arr.filter((f) => !bad.includes(f))].slice(0, 20));
  };

  const locate = () => {
    if (!navigator.geolocation) return setGeoMsg('Location is not available in this browser. Enter coordinates manually.');
    setGeoMsg('Requesting location permission…');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLat(p.coords.latitude.toFixed(6));
        setLng(p.coords.longitude.toFixed(6));
        setGeoSource('DEVICE');
        setGeoMsg(`Location captured (±${Math.round(p.coords.accuracy)} m). Photos with embedded GPS keep their own coordinates.`);
      },
      (e) => setGeoMsg(`Location unavailable (${e.message}). Enter coordinates manually.`),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    setErr(null);
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f));
    fd.append('category', category);
    if (caption) fd.append('caption', caption);
    if (description) fd.append('description', description);
    if (takenAt) fd.append('takenAt', takenAt);
    if (withGeo && useGeo && lat && lng) {
      fd.append('latitude', lat);
      fd.append('longitude', lng);
      fd.append('locationSource', geoSource);
    }
    try {
      await api.upload(`/api/files/${target}/${entityId}`, fd);
      toast('success', `${files.length} file(s) uploaded.`);
      setFiles([]);
      setCaption('');
      setDescription('');
      setTakenAt('');
      onUploaded();
    } catch (e: any) {
      setErr(e.message + (e.fields && Object.keys(e.fields).length ? ` (${Object.values(e.fields).join(', ')})` : ''));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={cx('flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 text-center transition', compact ? 'py-4' : 'py-6', drag ? 'border-brand bg-brand-50' : 'border-gray-300 bg-gray-50/50')}
      >
        {kind === 'photo' ? <ImagePlus className="size-7 text-ink-3" /> : <Upload className="size-7 text-ink-3" />}
        <p className="text-sm text-ink-2">
          Drag &amp; drop {kind === 'photo' ? 'photos' : 'files'} here, or{' '}
          <button type="button" className="font-medium text-brand underline" onClick={() => input.current?.click()}>
            browse
          </button>
        </p>
        <p className="text-xs text-ink-3">
          {kind === 'photo' ? 'JPG, JPEG, PNG or WebP' : kind === 'pdfimage' ? 'PDF, JPG, JPEG or PNG' : 'PDF, DOCX, XLSX, PPTX or images'} · max {maxMb} MB each
        </p>
        <input ref={input} type="file" multiple accept={accept} className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <div className="space-y-3 rounded-xl border border-line bg-white p-3">
          <ul className="flex flex-wrap gap-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-gray-50 py-1 pl-2 pr-1 text-xs">
                {f.type.startsWith('image/') ? <img src={URL.createObjectURL(f)} alt="" className="size-8 rounded object-cover" /> : <FileText className="size-4 text-ink-3" />}
                <span className="max-w-[160px] truncate">{f.name}</span>
                <span className="text-ink-3">{fmtSize(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="rounded p-0.5 hover:bg-gray-200">
                  <X className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {categories.length > 1 && <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={categories} />}
            <Input label="Caption / description" value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={300} />
            {kind === 'photo' && <Input label="Date taken" type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} hint="Leave blank to use the photo's own timestamp" />}
            {withDescription && <Input label="Description" wrapClass="sm:col-span-3" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />}
          </div>
          {withGeo && (
            <div className="space-y-2 rounded-lg bg-gray-50 p-3">
              <Checkbox checked={useGeo} onChange={setUseGeo} label="Attach a location to photos without embedded GPS" />
              {useGeo && (
                <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
                  <Input label="Latitude" inputMode="decimal" value={lat} onChange={(e) => { setLat(e.target.value); setGeoSource('MANUAL'); }} placeholder="34.2009" />
                  <Input label="Longitude" inputMode="decimal" value={lng} onChange={(e) => { setLng(e.target.value); setGeoSource('MANUAL'); }} placeholder="72.0518" />
                  <Button type="button" variant="secondary" onClick={locate} icon={<LocateFixed className="size-4" />}>
                    Use my location
                  </Button>
                  {geoMsg && <p className="text-xs text-ink-3 sm:col-span-3">{geoMsg}</p>}
                  <p className="text-xs text-ink-3 sm:col-span-3">Recorded as: {LOCATION_LABEL[geoSource]}</p>
                </div>
              )}
            </div>
          )}
          <div className="flex justify-end">
            <Button loading={busy} onClick={submit} icon={<Upload className="size-4" />}>
              Upload {files.length} file{files.length > 1 ? 's' : ''}
            </Button>
          </div>
        </div>
      )}
      {err && <p className="text-sm text-red-600" role="alert">{err}</p>}
    </div>
  );
}

/** Responsive thumbnail gallery with a keyboard-navigable full-screen preview. */
export function Gallery({ photos, onChanged, canRemove, emptyText = 'No pictures uploaded.', meta }: { photos: FileRow[]; onChanged?: () => void; canRemove?: (f: FileRow) => boolean; emptyText?: string; meta?: (f: any) => ReactNode }) {
  const [idx, setIdx] = useState<number | null>(null);
  const confirm = useConfirm();
  const toast = useToast();
  const cur = idx !== null ? photos[idx] : null;
  const move = useCallback((d: number) => setIdx((i) => (i === null ? i : (i + d + photos.length) % photos.length)), [photos.length]);
  useEffect(() => {
    if (idx === null) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') move(1); if (e.key === 'ArrowLeft') move(-1); };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [idx, move]);
  if (!photos.length) return <Empty title={emptyText} />;
  const remove = async (f: FileRow) => {
    if (!(await confirm({ title: 'Remove picture?', message: `"${f.originalName}" will be removed from this record. The removal is recorded in the audit log.`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await api.del(`/api/files/${f.id}`);
      toast('success', 'Removed.');
      setIdx(null);
      onChanged?.();
    } catch (e: any) {
      toast('error', e.message);
    }
  };
  return (
    <>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {photos.map((p, i) => (
          <li key={p.id} className="group overflow-hidden rounded-xl border border-line bg-white shadow-sm">
            <button type="button" onClick={() => setIdx(i)} className="block aspect-[4/3] w-full overflow-hidden bg-gray-100" aria-label={`Preview ${p.caption ?? p.originalName}`}>
              <img src={fileUrl(p.id)} alt={p.caption ?? p.originalName} loading="lazy" className="size-full object-cover transition group-hover:scale-105" />
            </button>
            <div className="space-y-0.5 p-2 text-xs">
              <p className="truncate font-medium text-ink">{p.caption ?? p.originalName}</p>
              <p className="text-ink-3">{humanize(p.category)}</p>
              <p className="text-ink-3">{p.uploadedBy.name} · {fmtDateTime(p.createdAt)}</p>
              {p.latitude != null && <p className="flex items-center gap-1 text-ink-3"><MapPin className="size-3" />{p.latitude.toFixed(4)}, {p.longitude!.toFixed(4)} · {p.locationSource === 'EXIF' ? 'EXIF' : humanize(p.locationSource)}</p>}
              {meta?.(p)}
            </div>
          </li>
        ))}
      </ul>
      <Modal open={!!cur} onClose={() => setIdx(null)} title={cur?.caption ?? cur?.originalName ?? ''} size="xl">
        {cur && (
          <div className="space-y-3">
            <div className="relative flex items-center justify-center rounded-lg bg-black">
              <img src={fileUrl(cur.id)} alt={cur.caption ?? cur.originalName} className="max-h-[65vh] w-auto object-contain" />
              {photos.length > 1 && (
                <>
                  <button className="absolute left-2 rounded-full bg-white/80 p-2 hover:bg-white" onClick={() => move(-1)} aria-label="Previous picture"><ChevronLeft className="size-5" /></button>
                  <button className="absolute right-2 rounded-full bg-white/80 p-2 hover:bg-white" onClick={() => move(1)} aria-label="Next picture"><ChevronRight className="size-5" /></button>
                </>
              )}
            </div>
            <div className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
              {(cur as any).description && <p className="sm:col-span-2">{(cur as any).description}</p>}
              <p><span className="text-ink-3">Category:</span> {humanize(cur.category)}</p>
              <p><span className="text-ink-3">Uploaded by:</span> {cur.uploadedBy.name}, {fmtDateTime(cur.createdAt)}</p>
              <p><span className="text-ink-3">Taken:</span> {cur.takenAt ? fmtDateTime(cur.takenAt) : '—'}{cur.exifTakenAt && <span className="text-ink-3"> (EXIF: {fmtDateTime(cur.exifTakenAt)})</span>}</p>
              <p><span className="text-ink-3">Location:</span> {cur.latitude != null ? `${cur.latitude.toFixed(6)}, ${cur.longitude!.toFixed(6)}` : '—'}<br /><span className="text-xs text-ink-3">{LOCATION_LABEL[cur.locationSource]}</span></p>
            </div>
            {cur.latitude != null && (
              <div className="h-56 overflow-hidden rounded-lg border border-line">
                <LazyMap points={[{ lat: cur.latitude, lng: cur.longitude!, label: cur.caption ?? cur.originalName }]} />
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {canRemove?.(cur) && <Button variant="danger" size="sm" icon={<Trash2 className="size-4" />} onClick={() => remove(cur)}>Remove</Button>}
              <a href={fileUrl(cur.id, true)} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:bg-gray-50"><Download className="size-4" />Download original</a>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

export function AttachmentList({ files, onChanged, canRemove }: { files: FileRow[]; onChanged?: () => void; canRemove?: (f: FileRow) => boolean }) {
  const confirm = useConfirm();
  const toast = useToast();
  if (!files.length) return <p className="text-sm text-ink-3">No documents attached.</p>;
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <FileText className="size-4 shrink-0 text-ink-3" />
          <div className="min-w-0 flex-1">
            <a href={fileUrl(f.id)} target="_blank" rel="noreferrer" className="block truncate font-medium text-brand hover:underline">{f.originalName}</a>
            <p className="text-xs text-ink-3">{humanize(f.category)} · {fmtSize(f.size)} · {f.uploadedBy.name}, {fmtDateTime(f.createdAt)}{f.caption ? ` · ${f.caption}` : ''}</p>
          </div>
          <a href={fileUrl(f.id, true)} className="rounded p-1.5 text-ink-3 hover:bg-gray-100" aria-label={`Download ${f.originalName}`}><Download className="size-4" /></a>
          {canRemove?.(f) && (
            <button
              className="rounded p-1.5 text-red-600 hover:bg-red-50"
              aria-label={`Remove ${f.originalName}`}
              onClick={async () => {
                if (!(await confirm({ title: 'Remove document?', message: f.originalName, confirmLabel: 'Remove', tone: 'danger' }))) return;
                try { await api.del(`/api/files/${f.id}`); onChanged?.(); } catch (e: any) { toast('error', e.message); }
              }}
            >
              <Trash2 className="size-4" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Leaflet is only loaded when a map is actually displayed
const MapViewLazy = lazy(() => import('./MapView'));
export function LazyMap(props: { points: { lat: number; lng: number; label: string; href?: string }[]; height?: string }) {
  return (
    <Suspense fallback={<div className="grid size-full place-items-center text-xs text-ink-3">Loading map…</div>}>
      <MapViewLazy {...props} />
    </Suspense>
  );
}
