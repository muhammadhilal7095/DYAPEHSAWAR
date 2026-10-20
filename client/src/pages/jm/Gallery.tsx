import { Link } from 'react-router';
import { qs } from '../../lib/api';
import { useApi, useCached, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { humanize } from '../../lib/format';
import { Card, PageHeader, Pagination, Spinner, Checkbox } from '../../components/ui';
import { Gallery, LazyMap } from '../../components/Files';
import { FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

const CATS = ['BEFORE_WORK', 'WORK_IN_PROGRESS', 'COMPLETED_WORK', 'DEFECT_EVIDENCE', 'OTHER'];

export default function JmGallery() {
  const districts = useDistricts();
  const assets = useCached<any>('/api/jm/assets')?.rows ?? [];
  const [q, setQ] = useQueryState({ q: '', assetId: '', districtId: '', category: '', located: '', from: '', to: '', page: '1' });
  const search = useDebounced(q.q);
  const { data, loading } = useApi(`/api/jm/monitoring/gallery${qs({ ...q, q: search })}`);
  return (
    <>
      <PageHeader title="Geo-Tagged Site Photographs" subtitle="Photographs from Jawan Markaz sites. Locations are labelled by source (photo EXIF, device at upload, or manual entry) and are not independently verified." />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', assetId: '', districtId: '', category: '', located: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="Caption, report or asset…" />
          <MiniSelect label="Asset" value={q.assetId} onChange={(v) => setQ({ assetId: v })} options={assets.map((a: any) => ({ value: a.id, label: a.name }))} />
          <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniSelect label="Photo type" value={q.category} onChange={(v) => setQ({ category: v })} options={CATS.map((c) => ({ value: c, label: humanize(c) }))} />
          <MiniDate label="Uploaded from" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="Uploaded to" value={q.to} onChange={(v) => setQ({ to: v })} />
          <div className="pb-2"><Checkbox checked={q.located === 'true'} onChange={(v) => setQ({ located: v ? 'true' : '' })} label="With location only" /></div>
        </FilterBar>
        {data?.points?.length > 0 && (
          <div className="h-72 border-b border-line">
            <LazyMap points={data.points.map((p: any) => ({ lat: p.latitude, lng: p.longitude, label: `${p.jmAsset?.name ?? ''} — ${p.caption ?? p.originalName} (${p.locationSource === 'EXIF' ? 'EXIF GPS' : humanize(p.locationSource)})`, href: p.jmAsset ? `/jm/assets/${p.jmAsset.id}` : undefined }))} />
          </div>
        )}
        <div className="p-4">
          {loading && !data ? <Spinner /> : (
            <Gallery
              photos={data?.rows ?? []}
              emptyText="No photographs match the filters."
              meta={(f: any) => (
                <>
                  {f.jmAsset && <Link to={`/jm/assets/${f.jmAsset.id}`} className="block truncate text-brand hover:underline">{f.jmAsset.name}</Link>}
                  {f.jmReport && <Link to={`/jm/reports/${f.jmReport.id}`} className="block truncate font-mono text-ink-3 hover:underline">{f.jmReport.reportNo}</Link>}
                </>
              )}
            />
          )}
        </div>
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
