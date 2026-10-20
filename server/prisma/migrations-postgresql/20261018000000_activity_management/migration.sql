-- AlterTable
ALTER TABLE "File" ADD COLUMN     "activityAssignmentId" TEXT;

-- AlterTable
ALTER TABLE "ActivityRequest" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "endTime" TEXT,
ADD COLUMN     "expectedParticipants" INTEGER,
ADD COLUMN     "lifecycle" TEXT NOT NULL DEFAULT 'DRAFT',
ADD COLUMN     "objectives" TEXT,
ADD COLUMN     "priority" TEXT NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "province" TEXT NOT NULL DEFAULT 'Khyber Pakhtunkhwa',
ADD COLUMN     "startTime" TEXT,
ADD COLUMN     "targetAudience" TEXT,
ADD COLUMN     "tehsil" TEXT,
ADD COLUMN     "venueAddress" TEXT;

-- AlterTable
ALTER TABLE "ActivityReport" ADD COLUMN     "achievements" TEXT,
ADD COLUMN     "challenges" TEXT,
ADD COLUMN     "expenseDetails" TEXT,
ADD COLUMN     "recommendations" TEXT;

-- CreateTable
CREATE TABLE "ActivityAssignment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "isLead" BOOLEAN NOT NULL DEFAULT false,
    "responsibilities" TEXT NOT NULL,
    "instructions" TEXT,
    "deadline" TIMESTAMP(3),
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "reviewRequirements" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ASSIGNED',
    "statusRemarks" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "reminderSentAt" TIMESTAMP(3),
    "overdueNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityAssignment_activityId_idx" ON "ActivityAssignment"("activityId");

-- CreateIndex
CREATE INDEX "ActivityAssignment_assigneeId_status_idx" ON "ActivityAssignment"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "ActivityAssignment_deadline_idx" ON "ActivityAssignment"("deadline");

-- CreateIndex
CREATE INDEX "File_activityAssignmentId_idx" ON "File"("activityAssignmentId");

-- CreateIndex
CREATE INDEX "ActivityRequest_lifecycle_idx" ON "ActivityRequest"("lifecycle");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_activityAssignmentId_fkey" FOREIGN KEY ("activityAssignmentId") REFERENCES "ActivityAssignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityAssignment" ADD CONSTRAINT "ActivityAssignment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityAssignment" ADD CONSTRAINT "ActivityAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityAssignment" ADD CONSTRAINT "ActivityAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


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
