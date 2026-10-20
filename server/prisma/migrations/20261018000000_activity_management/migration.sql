-- AlterTable
ALTER TABLE "ActivityReport" ADD COLUMN "achievements" TEXT;
ALTER TABLE "ActivityReport" ADD COLUMN "challenges" TEXT;
ALTER TABLE "ActivityReport" ADD COLUMN "expenseDetails" TEXT;
ALTER TABLE "ActivityReport" ADD COLUMN "recommendations" TEXT;

-- CreateTable
CREATE TABLE "ActivityAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "activityId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "responsibilities" TEXT NOT NULL,
    "instructions" TEXT,
    "deadline" DATETIME,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "reviewRequirements" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "statusRemarks" TEXT,
    "acknowledgedAt" DATETIME,
    "completedAt" DATETIME,
    "reminderSentAt" DATETIME,
    "overdueNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActivityAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityRequest" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ActivityAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_File" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "caption" TEXT,
    "takenAt" DATETIME,
    "latitude" REAL,
    "longitude" REAL,
    "locationSource" TEXT NOT NULL DEFAULT 'NONE',
    "exifTakenAt" DATETIME,
    "exifLatitude" REAL,
    "exifLongitude" REAL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" DATETIME,
    "activityRequestId" TEXT,
    "activityReportId" TEXT,
    "bookingId" TEXT,
    "jmReportId" TEXT,
    "jmAssetId" TEXT,
    "jmActionId" TEXT,
    "activityAssignmentId" TEXT,
    CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "File_activityAssignmentId_fkey" FOREIGN KEY ("activityAssignmentId") REFERENCES "ActivityAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_activityRequestId_fkey" FOREIGN KEY ("activityRequestId") REFERENCES "ActivityRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_activityReportId_fkey" FOREIGN KEY ("activityReportId") REFERENCES "ActivityReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmReportId_fkey" FOREIGN KEY ("jmReportId") REFERENCES "JmReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmAssetId_fkey" FOREIGN KEY ("jmAssetId") REFERENCES "JmAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmActionId_fkey" FOREIGN KEY ("jmActionId") REFERENCES "JmAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_File" ("activityReportId", "activityRequestId", "bookingId", "caption", "category", "createdAt", "deletedAt", "exifLatitude", "exifLongitude", "exifTakenAt", "id", "jmActionId", "jmAssetId", "jmReportId", "kind", "latitude", "locationSource", "longitude", "mimeType", "originalName", "sha256", "size", "storedName", "takenAt", "uploadedById") SELECT "activityReportId", "activityRequestId", "bookingId", "caption", "category", "createdAt", "deletedAt", "exifLatitude", "exifLongitude", "exifTakenAt", "id", "jmActionId", "jmAssetId", "jmReportId", "kind", "latitude", "locationSource", "longitude", "mimeType", "originalName", "sha256", "size", "storedName", "takenAt", "uploadedById" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE UNIQUE INDEX "File_storedName_key" ON "File"("storedName");
CREATE INDEX "File_activityRequestId_idx" ON "File"("activityRequestId");
CREATE INDEX "File_activityReportId_idx" ON "File"("activityReportId");
CREATE INDEX "File_bookingId_idx" ON "File"("bookingId");
CREATE INDEX "File_jmReportId_idx" ON "File"("jmReportId");
CREATE INDEX "File_jmAssetId_idx" ON "File"("jmAssetId");
CREATE INDEX "File_activityAssignmentId_idx" ON "File"("activityAssignmentId");
CREATE TABLE "new_ActivityRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "daamrId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesteeEmail" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "departmentId" TEXT,
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "venue" TEXT NOT NULL,
    "proposedBudget" REAL NOT NULL DEFAULT 0,
    "objectives" TEXT,
    "targetAudience" TEXT,
    "expectedParticipants" INTEGER,
    "startTime" TEXT,
    "endTime" TEXT,
    "province" TEXT NOT NULL DEFAULT 'Khyber Pakhtunkhwa',
    "tehsil" TEXT,
    "venueAddress" TEXT,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "lifecycle" TEXT NOT NULL DEFAULT 'DRAFT',
    "completedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "workflowInstanceId" TEXT,
    "updatedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActivityRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityRequest_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityRequest_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_ActivityRequest" ("approvedAt", "area", "category", "createdAt", "daamrId", "departmentId", "description", "districtId", "endDate", "executionStatus", "id", "proposedBudget", "requesteeEmail", "requesterId", "startDate", "status", "subject", "submittedAt", "updatedAt", "updatedById", "venue", "version", "workflowInstanceId") SELECT "approvedAt", "area", "category", "createdAt", "daamrId", "departmentId", "description", "districtId", "endDate", "executionStatus", "id", "proposedBudget", "requesteeEmail", "requesterId", "startDate", "status", "subject", "submittedAt", "updatedAt", "updatedById", "venue", "version", "workflowInstanceId" FROM "ActivityRequest";
DROP TABLE "ActivityRequest";
ALTER TABLE "new_ActivityRequest" RENAME TO "ActivityRequest";
CREATE UNIQUE INDEX "ActivityRequest_daamrId_key" ON "ActivityRequest"("daamrId");
CREATE UNIQUE INDEX "ActivityRequest_workflowInstanceId_key" ON "ActivityRequest"("workflowInstanceId");
CREATE INDEX "ActivityRequest_status_idx" ON "ActivityRequest"("status");
CREATE INDEX "ActivityRequest_lifecycle_idx" ON "ActivityRequest"("lifecycle");
CREATE INDEX "ActivityRequest_districtId_idx" ON "ActivityRequest"("districtId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "ActivityAssignment_activityId_idx" ON "ActivityAssignment"("activityId");

-- CreateIndex
CREATE INDEX "ActivityAssignment_assigneeId_status_idx" ON "ActivityAssignment"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ActivityAssignment_deadline_idx" ON "ActivityAssignment"("deadline");


-- Backfill the overall activity lifecycle from existing approval / report state
UPDATE "ActivityRequest" SET "lifecycle" = CASE
  WHEN "status" = 'DRAFT' THEN 'DRAFT'
  WHEN "status" IN ('PENDING_REVIEW', 'UNDER_REVIEW') THEN 'UNDER_REVIEW'
  WHEN "status" = 'RETURNED' THEN 'CHANGES_REQUESTED'
  WHEN "status" = 'REJECTED' THEN 'REJECTED'
  WHEN "status" = 'APPROVED' THEN COALESCE(
    (SELECT CASE r."reportStatus"
        WHEN 'VERIFIED' THEN 'COMPLETED'
        WHEN 'UNDER_VERIFICATION' THEN 'REPORT_REVIEW'
        WHEN 'SUBMITTED' THEN 'REPORT_REVIEW'
        WHEN 'RETURNED' THEN 'CHANGES_REQUESTED'
        WHEN 'REJECTED' THEN 'REJECTED'
        ELSE 'IN_PROGRESS' END
     FROM "ActivityReport" r WHERE r."requestId" = "ActivityRequest"."id"),
    CASE WHEN "executionStatus" IN ('IN_PROGRESS', 'COMPLETED') THEN 'IN_PROGRESS' ELSE 'APPROVED' END)
  ELSE 'DRAFT' END;
UPDATE "ActivityRequest" SET "completedAt" = (SELECT r."verifiedAt" FROM "ActivityReport" r WHERE r."requestId" = "ActivityRequest"."id") WHERE "lifecycle" = 'COMPLETED';
