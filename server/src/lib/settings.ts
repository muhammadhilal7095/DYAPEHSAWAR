import { prisma, type Db } from '../db.js';

/** Default values for every configurable setting. Stored overrides live in SystemSetting. */
export const DEFAULT_SETTINGS = {
  orgName: 'Directorate of Youth Affairs',
  orgSubtitle: 'Government of Khyber Pakhtunkhwa',
  logoFileId: null as string | null,
  themeColor: '#0f5132',
  timezone: 'Asia/Karachi',
  sessionIdleMinutes: 30,
  sessionMaxHours: 12,
  maxUploadMb: 10,
  // DAAMR: which demographic fields are summed into "Total Participants".
  // Minority / Madaris / Disabled / Juvenile usually overlap with the gender counts, so by default
  // the total is Male + Female + Transgender to avoid double-counting.
  participantTotalFields: ['male', 'female', 'transgender'] as string[],
  // Hostels
  hostelDashboardFilterMode: 'HOSTEL' as 'HOSTEL' | 'FACILITY_TYPE',
  hostelExtensionRequiresOverride: true,
  // Jawan Markaz delay classification thresholds
  jmSlightDelayMaxDays: 30, // delay 1..N days → slightly delayed; > N → significantly delayed
  jmSlightGapMaxPct: 10, // planned − actual progress gap (pp) up to N → slightly; above → significantly
  jmSatisfactoryQualityValues: ['EXCELLENT', 'GOOD', 'SATISFACTORY'] as string[],
  // Risk level bands on probability × impact score
  jmRiskBands: { low: 4, medium: 9, high: 15 }, // ≤low → LOW, ≤medium → MEDIUM, ≤high → HIGH, else CRITICAL
  jmRemindersEnabled: true, // daily email/in-app reminders for overdue corrective actions and inspections
  // Activity management
  activityDeadlineReminderDays: 2, // remind assigned staff this many days before a task deadline
  activityRemindersEnabled: true, // in-app/email reminders for upcoming and overdue assignment deadlines
  // Course execution
  courseNonTrainingWeekdays: [0] as number[], // 0 = Sunday … 6 = Saturday; skipped when generating schedules
  courseHolidays: [] as string[], // YYYY-MM-DD dates with no training
  courseReportDueDays: 1, // a daily report is flagged missing this many days after the session date
  courseRequirePhotos: true, // at least one photograph is required before a daily report can be submitted
  courseCompletionGraceDays: 7, // a course is overdue when not completed this many days after its last session
  // Database backups (SQLite: online copy; PostgreSQL: pg_dump if available)
  backupEnabled: true,
  backupKeep: 14, // number of daily backups to keep
  jmCertificationStatement:
    'I certify that the information provided in this report is true and accurate to the best of my knowledge, and is based on my personal inspection of the site.',
};

export type Settings = typeof DEFAULT_SETTINGS;
export type SettingKey = keyof Settings;

let cache: { at: number; value: Settings } | null = null;

export async function getSettings(db: Db = prisma): Promise<Settings> {
  if (cache && Date.now() - cache.at < 5000 && db === prisma) return cache.value;
  const rows = await db.systemSetting.findMany();
  const value = { ...DEFAULT_SETTINGS } as any;
  for (const r of rows) if (r.key in DEFAULT_SETTINGS) value[r.key] = r.value;
  if (db === prisma) cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = null;
}

/** Settings that are safe to expose to every authenticated (or anonymous, for login branding) user. */
export function publicSettings(s: Settings) {
  return {
    orgName: s.orgName,
    orgSubtitle: s.orgSubtitle,
    logoFileId: s.logoFileId,
    themeColor: s.themeColor,
    timezone: s.timezone,
    maxUploadMb: s.maxUploadMb,
    participantTotalFields: s.participantTotalFields,
    jmCertificationStatement: s.jmCertificationStatement,
    sessionIdleMinutes: s.sessionIdleMinutes,
  };
}
