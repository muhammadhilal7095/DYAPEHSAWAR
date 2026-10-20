import { Link, useParams } from 'react-router';
import { ExternalLink, Pencil, Printer } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { useHashScroll, useApi, useLookupLabel } from '../../lib/hooks';
import { fmtDate, fmtDateTime, fmtMoney, fmtNum, humanize } from '../../lib/format';
import { Badge, Button, Card, ErrorBox, KV, LinkButton, Notice, PageHeader, Spinner } from '../../components/ui';
import { CurrentOfficer, ReviewPanel, Timeline } from '../../components/Workflow';
import { AttachmentList, Gallery } from '../../components/Files';
import { DEMOGRAPHICS, PLATFORMS } from './ReportForm';

export default function ReportDetail() {
  const { id } = useParams();
  const { me, settings } = useAuth();
  const cat = useLookupLabel('ACTIVITY_CATEGORY');
  const { data, loading, error, reload } = useApi(`/api/daamr/reports/${id}`);
  useHashScroll(!!data);
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data) return null;
  const r = data.report;
  const p = r.participants;
  const b = r.budget;
  const counted = (p?.countingRule as string[]) ?? settings?.participantTotalFields ?? [];
  const reqPhotos = r.request && !r.request.hidden ? r.request.files.filter((f: any) => f.kind === 'PHOTO') : [];
  const photos = [...r.files.filter((f: any) => f.kind === 'PHOTO'), ...reqPhotos];

  return (
    <>
      <PageHeader
        back="/daamr/reports"
        title={r.activityName}
        subtitle={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{r.daamrId}</span><span className="text-ink-3">· Report {r.reportNo}</span><Badge status={r.reportStatus} /><Badge status={r.activityStatus} label={`Activity: ${humanize(r.activityStatus)}`} /></span>}
        actions={<>{data.can.edit && <LinkButton to={`/daamr/reports/${id}/edit`} variant="secondary" icon={<Pencil className="size-4" />}>Edit</LinkButton>}<Button variant="secondary" icon={<Printer className="size-4" />} onClick={() => window.print()}>Print</Button></>}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {r.reportStatus === 'DRAFT' && <Notice>This report is a draft and has not been submitted for verification.</Notice>}
          <div id="review"><ReviewPanel base={`/api/daamr/reports/${id}`} can={data.can} onDone={reload} approveLabel="Verify & forward" finalApproveLabel={r.requestId ? 'Final approval — mark activity completed' : 'Mark as Verified'} rejectLabel="Reject report" returnLabel="Request changes" evidenceTarget={data.can.canDecide ? { target: 'activity-report', entityId: r.id } : undefined} /></div>
          <Card title="Activity information">
            <KV cols={3} items={[
              ['DAAMR ID', <span className="font-mono">{r.daamrId}</span>], ['Activity date', fmtDate(r.activityDate)], ['District', r.district.name],
              ['Activity category', cat(r.category)], ['Venue', r.venue], ['Responsible officer', r.responsibleOfficer],
              ['Department / HQ', r.department?.name], ['Activity status', humanize(r.activityStatus)],
              ['Linked activity', r.request ? <Link className="text-brand hover:underline" to={`/daamr/requests/${r.request.id}`}>{r.request.daamrId}</Link> : 'Standalone report'],
              ['Created by', `${r.createdBy.name}, ${fmtDateTime(r.createdAt)}`], ['Last updated', fmtDateTime(r.updatedAt)], ['Verified', r.verifiedAt ? fmtDateTime(r.verifiedAt) : '—'],
            ]} />
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-3">Description</p>
              <p className="mt-1 whitespace-pre-line text-sm">{r.description}</p>
              {r.remarks && <><p className="mt-3 text-xs font-medium uppercase tracking-wide text-ink-3">Staff remarks</p><p className="mt-1 whitespace-pre-line text-sm">{r.remarks}</p></>}
            </div>
          </Card>
          {(r.achievements || r.challenges || r.recommendations) && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
              <Card title="Achievements and outcomes"><p className="whitespace-pre-line text-sm">{r.achievements || '—'}</p></Card>
              <Card title="Challenges faced"><p className="whitespace-pre-line text-sm">{r.challenges || '—'}</p></Card>
              <Card title="Recommendations"><p className="whitespace-pre-line text-sm">{r.recommendations || '—'}</p></Card>
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Card title="Participant demographics" subtitle={`Total = ${counted.map(humanize).join(' + ')}`}>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-line">
                  {DEMOGRAPHICS.map((d) => <tr key={d}><td className="py-1.5 text-ink-2">{humanize(d)}{counted.includes(d) ? '' : <span className="ml-1 text-xs text-ink-3">(sub-category)</span>}</td><td className="tabular py-1.5 text-right">{fmtNum(p?.[d])}</td></tr>)}
                  <tr className="font-semibold"><td className="py-2">Total participants</td><td className="tabular py-2 text-right">{fmtNum(p?.total)}</td></tr>
                </tbody>
              </table>
            </Card>
            <Card title="Budget and expenses">
              {data.can.viewExpenses ? (
                <>
                  <KV cols={1} items={[['Allocated', fmtMoney(b?.allocated)], ['Utilized', fmtMoney(b?.utilized)], ['Remaining', <span className={b?.remaining < 0 ? 'font-semibold text-red-700' : ''}>{fmtMoney(b?.remaining)}{b?.remaining < 0 && ' — over budget'}</span>], ['Fund source', b?.fundSource], ['Budget remarks', b?.remarks]]} />
                  {r.expenseDetails && <div className="mt-3 border-t border-line pt-3"><p className="text-xs font-medium uppercase tracking-wide text-ink-3">Expense details</p><p className="mt-1 whitespace-pre-line text-sm">{r.expenseDetails}</p></div>}
                </>
              ) : <p className="text-sm text-ink-3">You are not authorised to view budget and expense details.</p>}
            </Card>
          </div>
          <Card title="Media coverage and publicity links">
            {r.mediaLinks.length ? (
              <ul className="space-y-1.5 text-sm">
                {r.mediaLinks.map((m: any) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2"><span className="w-28 text-ink-3">{PLATFORMS.find((x) => x.value === m.platform)?.label}</span><a href={m.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-center gap-1 break-all text-brand hover:underline">{m.url}<ExternalLink className="size-3.5 shrink-0" /></a></li>
                ))}
              </ul>
            ) : <p className="text-sm text-ink-3">No links provided.</p>}
          </Card>
          <Card title="Activity photographs" subtitle={reqPhotos.length ? 'Includes venue and evidence pictures from the approved request.' : undefined}>
            <h3 className="mb-2 text-sm font-semibold">Event photographs</h3>
            <Gallery photos={photos.filter((x: any) => x.category === 'EVENT')} onChanged={reload} canRemove={(f) => data.can.edit && f.uploadedBy.id === me?.id} emptyText="No event photographs." />
            <h3 className="mb-2 mt-5 text-sm font-semibold">After the activity</h3>
            <Gallery photos={photos.filter((x: any) => x.category === 'POST_ACTIVITY')} onChanged={reload} canRemove={(f) => data.can.edit && f.uploadedBy.id === me?.id} emptyText="No evidence photographs." />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Before the activity / venue</h3>
            <Gallery photos={photos.filter((x: any) => x.category === 'PRE_ACTIVITY')} emptyText="No venue pictures." />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Attendance sheet</h3>
            <AttachmentList files={r.files.filter((f: any) => f.category === 'ATTENDANCE')} onChanged={reload} canRemove={(f) => data.can.edit && f.uploadedBy.id === me?.id} />
            <h3 className="mb-2 mt-5 text-sm font-semibold">Supporting documents</h3>
            <AttachmentList files={r.files.filter((f: any) => (f.kind === 'DOCUMENT' || f.category === 'REVIEW_EVIDENCE') && f.category !== 'ATTENDANCE')} onChanged={reload} canRemove={(f) => (data.can.edit || f.category === 'REVIEW_EVIDENCE') && f.uploadedBy.id === me?.id} />
          </Card>
        </div>
        <div className="space-y-4">
          {data.verificationTimeline && <CurrentOfficer tl={data.verificationTimeline} />}
          {data.verificationTimeline && <Timeline tl={data.verificationTimeline} title="Report verification" />}
          {data.requestTimeline && <div id="timeline"><Timeline tl={data.requestTimeline} title="Original request approval" /></div>}
        </div>
      </div>
    </>
  );
}
