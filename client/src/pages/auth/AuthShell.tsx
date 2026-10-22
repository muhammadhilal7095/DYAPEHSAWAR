import type { ReactNode } from 'react';
import { BedDouble, Building2, CalendarCheck, GraduationCap, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { fileUrl } from '../../lib/api';

const MODULES = [
  { icon: CalendarCheck, title: 'Activities (DAAMR)', text: 'Requests, multi-level approvals and execution reports' },
  { icon: GraduationCap, title: 'Courses', text: 'Daily sessions, attendance and final course reports' },
  { icon: BedDouble, title: 'Youth Hostels', text: 'Bookings, room allocation, check-in and utilization' },
  { icon: Building2, title: 'Jawan Markaz', text: 'Inspections, progress, risks and geo-tagged evidence' },
];

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { settings } = useAuth();
  const orgName = settings?.orgName ?? 'Directorate of Youth Affairs';
  const orgSubtitle = settings?.orgSubtitle || 'Government of Khyber Pakhtunkhwa';
  const dyaLogo = settings?.logoFileId ? fileUrl(settings.logoFileId) : '/logos/dya.jpg';

  return (
    <div className="grid min-h-dvh bg-surface lg:grid-cols-[1.15fr_1fr]">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-gradient-to-br from-brand-700 via-brand-800 to-[#062a1a] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '22px 22px' }}
        />
        <div aria-hidden className="pointer-events-none absolute -right-32 -top-32 size-[28rem] rounded-full bg-white/[0.04] ring-1 ring-white/10" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 -left-24 size-[26rem] rounded-full bg-white/[0.03] ring-1 ring-white/10" />

        <div className="relative flex items-center gap-4">
          <img src="/logos/kp-govt.jpg" alt="Government of Khyber Pakhtunkhwa" className="size-16 rounded-2xl object-cover shadow-lg ring-2 ring-white/20" />
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-white/60">Government of</p>
            <p className="text-lg font-semibold leading-tight">Khyber Pakhtunkhwa</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="flex items-center gap-5">
            <img src={dyaLogo} alt={orgName} className="size-28 shrink-0 rounded-3xl bg-white object-contain p-2 shadow-2xl ring-4 ring-white/10" />
            <div>
              <p className="text-2xl font-bold leading-tight xl:text-3xl">{orgName}</p>
              <p className="mt-1 text-sm text-white/70">{orgSubtitle}</p>
            </div>
          </div>
          <h2 className="mt-10 text-3xl font-semibold leading-tight xl:text-4xl">
            Integrated Activity, Hostel &amp; <span className="text-emerald-300">Asset Management</span> Portal
          </h2>
          <div className="mt-8 grid grid-cols-2 gap-3">
            {MODULES.map(({ icon: Icon, title, text }) => (
              <div key={title} className="rounded-xl bg-white/[0.07] p-4 ring-1 ring-white/10 backdrop-blur-sm">
                <Icon className="size-5 text-emerald-300" aria-hidden />
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-white/65">{text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative flex items-center gap-2 text-xs text-white/55">
          <ShieldCheck className="size-4" aria-hidden />
          Authorised users only. All activity is recorded in the audit log.
        </p>
      </div>

      {/* Form panel */}
      <div className="flex flex-col items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 flex items-center justify-center gap-4 lg:hidden">
            <img src="/logos/kp-govt.jpg" alt="Government of Khyber Pakhtunkhwa" className="size-14 rounded-xl object-cover shadow" />
            <img src={dyaLogo} alt={orgName} className="size-16 rounded-xl bg-white object-contain p-1 shadow" />
          </div>
          <div className="rounded-2xl bg-card p-6 shadow-xl shadow-brand/5 ring-1 ring-line sm:p-8">
            <div className="mb-6 hidden items-center gap-3 border-b border-line pb-5 lg:flex">
              <img src={dyaLogo} alt="" className="size-11 rounded-lg object-contain" />
              <div>
                <p className="text-sm font-semibold text-brand">{orgName}</p>
                <p className="text-xs text-ink-3">{orgSubtitle}</p>
              </div>
            </div>
            <p className="text-center text-sm font-semibold text-brand lg:hidden">{orgName}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight max-lg:text-center">{title}</h1>
            {subtitle && <p className="mt-1 text-sm text-ink-3 max-lg:text-center">{subtitle}</p>}
            <div className="mt-6">{children}</div>
          </div>
          <p className="mt-6 text-center text-xs text-ink-3">
            © {new Date().getFullYear()} {orgName}, {orgSubtitle}
          </p>
        </div>
      </div>
    </div>
  );
}
