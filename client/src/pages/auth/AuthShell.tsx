import type { ReactNode } from 'react';
import { useAuth } from '../../lib/auth';
import { fileUrl } from '../../lib/api';

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { settings } = useAuth();
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand-800 p-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          {settings?.logoFileId ? <img src={fileUrl(settings.logoFileId)} alt="" className="size-12 rounded-lg bg-white object-contain p-1" /> : <div className="grid size-12 place-items-center rounded-lg bg-white/15 font-bold">DYA</div>}
          <div>
            <p className="text-lg font-semibold">{settings?.orgName ?? 'Directorate of Youth Affairs'}</p>
            <p className="text-sm text-white/70">{settings?.orgSubtitle}</p>
          </div>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Integrated Activity, Hostel &amp; Asset Management Portal</h2>
          <ul className="mt-6 space-y-3 text-sm text-white/85">
            <li>• DAAMR activity requests, multi-level approvals and final activity reporting</li>
            <li>• Youth hostel bookings, room allocation, check-in &amp; utilization</li>
            <li>• Jawan Markaz inspections, progress, quality, risks &amp; geo-tagged evidence</li>
          </ul>
        </div>
        <p className="text-xs text-white/50">Authorised users only. All activity is recorded in the audit log.</p>
        <div className="pointer-events-none absolute -right-24 -top-24 size-96 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-32 right-10 size-80 rounded-full bg-white/5" />
      </div>
      <div className="flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-6 lg:hidden">
            <p className="text-lg font-semibold text-brand">{settings?.orgName ?? 'Directorate of Youth Affairs'}</p>
            <p className="text-xs text-ink-3">{settings?.orgSubtitle}</p>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}
