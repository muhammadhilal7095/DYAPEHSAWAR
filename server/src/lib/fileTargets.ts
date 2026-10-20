import type { File as FileRow } from '@prisma/client';
import type { AuthUser } from './auth.js';

/** Each entity that can own uploaded files registers how access is decided. */
export interface FileTarget {
  key: string; // url segment, e.g. "activity-request"
  fk: 'activityRequestId' | 'activityReportId' | 'bookingId' | 'jmReportId' | 'jmAssetId' | 'jmActionId' | 'activityAssignmentId' | 'courseId' | 'courseSessionId';
  module: string;
  entityType: string;
  /** category → accepted content: photo (JPG/PNG/WebP), doc (PDF/Office/images), pdfimage (PDF/JPG/PNG) */
  categories: Record<string, 'photo' | 'doc' | 'pdfimage'>;
  canView(user: AuthUser, id: string): Promise<boolean>;
  /** Returns the human reference (for audit) when the user may upload to the entity in this category, else null. */
  canUpload(user: AuthUser, id: string, category: string): Promise<{ ref: string; extra?: Record<string, string> } | null>;
  canDelete(user: AuthUser, id: string, file: FileRow): Promise<boolean>;
}

const targets = new Map<string, FileTarget>();
export function registerFileTarget(t: FileTarget) {
  targets.set(t.key, t);
}
export function fileTarget(key: string) {
  return targets.get(key);
}
export function targetForFile(f: FileRow): { target: FileTarget; id: string } | null {
  for (const t of targets.values()) {
    const id = (f as any)[t.fk];
    if (id) return { target: t, id };
  }
  return null;
}
