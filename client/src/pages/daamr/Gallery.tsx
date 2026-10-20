import { Link } from 'react-router';
import { qs } from '../../lib/api';
import { useApi, useDebounced, useDistricts, useQueryState } from '../../lib/hooks';
import { Card, PageHeader, Pagination, Spinner } from '../../components/ui';
import { Gallery } from '../../components/Files';
import { FilterBar, MiniDate, MiniSelect, SearchInput } from '../../components/DataTable';

export default function DaamrGallery() {
  const districts = useDistricts();
  const [q, setQ] = useQueryState({ q: '', category: '', districtId: '', from: '', to: '', page: '1' });
  const search = useDebounced(q.q);
  const { data, loading } = useApi(`/api/daamr/gallery${qs({ ...q, q: search })}`);
  return (
    <>
      <PageHeader title="Activity Picture Gallery" subtitle="Venue and evidence photographs across all DAAMR requests and activity reports you can access." />
      <Card bodyClass="p-0">
        <FilterBar onReset={() => setQ({ q: '', category: '', districtId: '', from: '', to: '' })}>
          <SearchInput value={q.q} onChange={(v) => setQ({ q: v })} placeholder="DAAMR ID, activity, caption…" />
          <MiniSelect label="Type" value={q.category} onChange={(v) => setQ({ category: v })} options={[{ value: 'PRE_ACTIVITY', label: 'Pre-activity venue' }, { value: 'POST_ACTIVITY', label: 'Post-activity evidence' }]} />
          <MiniSelect label="District" value={q.districtId} onChange={(v) => setQ({ districtId: v })} options={districts.map((d) => ({ value: d.id, label: d.name }))} />
          <MiniDate label="Uploaded from" value={q.from} onChange={(v) => setQ({ from: v })} />
          <MiniDate label="Uploaded to" value={q.to} onChange={(v) => setQ({ to: v })} />
        </FilterBar>
        <div className="p-4">
          {loading && !data ? <Spinner /> : (
            <Gallery
              photos={data?.rows ?? []}
              emptyText="No photographs match the filters."
              meta={(f: any) => {
                const src = f.activityReport ? { to: `/daamr/reports/${f.activityReport.id}`, id: f.activityReport.daamrId, d: f.activityReport.district.name } : f.activityRequest ? { to: `/daamr/requests/${f.activityRequest.id}`, id: f.activityRequest.daamrId, d: f.activityRequest.district.name } : null;
                return src && <Link to={src.to} className="block truncate font-mono text-brand hover:underline">{src.id} · {src.d}</Link>;
              }}
            />
          )}
        </div>
        {data && <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onPage={(p) => setQ({ page: String(p) })} />}
      </Card>
    </>
  );
}
