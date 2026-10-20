import { useEffect, useState, type ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cx } from './ui';

export interface FormSection { id: string; label: string; error?: boolean }

/** "On this page" list for long forms: jump links, highlights the section in view and flags sections with errors. */
export function SectionNav({ sections, title = 'On this form' }: { sections: FormSection[]; title?: string }) {
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const els = sections.map((s) => document.getElementById(s.id)).filter(Boolean) as HTMLElement[];
    if (!els.length || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (vis[0]) setActive(vis[0].target.id);
      },
      { rootMargin: '-80px 0px -60% 0px' },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, [sections.map((s) => s.id).join()]);
  return (
    <nav aria-label={title} className="no-print">
      <p className="mb-1.5 px-2 text-[11px] font-semibold uppercase tracking-wider text-ink-3">{title}</p>
      <ul className="space-y-0.5 text-sm">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); setActive(s.id); }}
              className={cx('flex items-center gap-2 rounded-md border-l-2 px-2 py-1.5 transition', active === s.id ? 'border-brand bg-brand-50 font-medium text-brand-800' : 'border-transparent text-ink-2 hover:bg-white hover:text-brand')}
            >
              <span className="flex-1">{s.label}</span>
              {s.error && <AlertCircle className="size-3.5 text-red-600" aria-label="Has errors" />}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Save / submit buttons pinned to the bottom of the screen on phones and tablets (the side panel holds them on desktop). */
export function MobileActions({ children }: { children: ReactNode }) {
  return (
    <>
      <div className="h-20 lg:hidden" aria-hidden />
      <div className="no-print fixed inset-x-0 bottom-0 z-30 flex gap-2 border-t border-line bg-white/95 p-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)] backdrop-blur lg:hidden [&>*]:flex-1">{children}</div>
    </>
  );
}

/** Wraps a form card so it can be targeted by SectionNav. */
export function FormSectionAnchor({ id, children }: { id: string; children: ReactNode }) {
  return <section id={id} className="scroll-mt-20">{children}</section>;
}
