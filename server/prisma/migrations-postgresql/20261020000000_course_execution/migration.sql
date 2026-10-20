-- AlterTable
ALTER TABLE "File" ADD COLUMN     "courseId" TEXT,
ADD COLUMN     "courseSessionId" TEXT,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ActivityRequest" ADD COLUMN     "activityType" TEXT NOT NULL DEFAULT 'EVENT',
ADD COLUMN     "deliveryFormat" TEXT,
ADD COLUMN     "methodology" TEXT,
ADD COLUMN     "proposedTrainers" JSONB,
ADD COLUMN     "trainingDays" INTEGER;

-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL,
    "courseNo" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" TEXT,
    "districtId" TEXT NOT NULL,
    "departmentId" TEXT,
    "venue" TEXT NOT NULL,
    "venueAddress" TEXT,
    "objectives" TEXT,
    "targetAudience" TEXT,
    "deliveryFormat" TEXT,
    "methodology" TEXT,
    "durationDays" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "dailyStartTime" TEXT,
    "dailyEndTime" TEXT,
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "coordinatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_START',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "startNotifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Course_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseTrainer" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "expertise" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseTrainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseStaff" (
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',

    CONSTRAINT "CourseStaff_pkey" PRIMARY KEY ("courseId","userId")
);

-- CreateTable
CREATE TABLE "CourseParticipant" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "institution" TEXT,
    "contact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSession" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "originalDate" TIMESTAMP(3) NOT NULL,
    "startTime" TEXT,
    "endTime" TEXT,
    "venue" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "conducted" BOOLEAN NOT NULL DEFAULT false,
    "isMakeup" BOOLEAN NOT NULL DEFAULT false,
    "resolutionReason" TEXT,
    "topic" TEXT,
    "learningObjectives" TEXT,
    "topicsCovered" TEXT,
    "activities" TEXT,
    "tools" TEXT,
    "achievements" TEXT,
    "challenges" TEXT,
    "nextPlan" TEXT,
    "attendanceMode" TEXT NOT NULL DEFAULT 'SUMMARY',
    "registeredCount" INTEGER,
    "presentCount" INTEGER,
    "absentCount" INTEGER,
    "attendanceRemarks" TEXT,
    "workflowInstanceId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "updatedById" TEXT,
    "reportDueNotifiedAt" TIMESTAMP(3),
    "dayNotifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseSessionTrainer" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "trainerId" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CourseSessionTrainer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remarks" TEXT,

    CONSTRAINT "SessionAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseScheduleChange" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "changeType" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3),
    "toDate" TIMESTAMP(3),
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseScheduleChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseCompletion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "summary" TEXT,
    "skillsDeveloped" TEXT,
    "projectsCompleted" TEXT,
    "learningOutcomes" TEXT,
    "achievements" TEXT,
    "challenges" TEXT,
    "recommendations" TEXT,
    "coordinatorRemarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "workflowInstanceId" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CourseCompletion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CourseReportVersion" (
    "id" TEXT NOT NULL,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "reason" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CourseReportVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Course_courseNo_key" ON "Course"("courseNo");

-- CreateIndex
CREATE UNIQUE INDEX "Course_activityId_key" ON "Course"("activityId");

-- CreateIndex
CREATE INDEX "Course_status_idx" ON "Course"("status");

-- CreateIndex
CREATE INDEX "Course_districtId_startDate_idx" ON "Course"("districtId", "startDate");

-- CreateIndex
CREATE INDEX "CourseTrainer_courseId_idx" ON "CourseTrainer"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseParticipant_courseId_registrationNo_key" ON "CourseParticipant"("courseId", "registrationNo");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSession_workflowInstanceId_key" ON "CourseSession"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "CourseSession_sessionDate_status_idx" ON "CourseSession"("sessionDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CourseSession_courseId_dayNumber_key" ON "CourseSession"("courseId", "dayNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SessionAttendance_sessionId_participantId_key" ON "SessionAttendance"("sessionId", "participantId");

-- CreateIndex
CREATE INDEX "CourseScheduleChange_courseId_createdAt_idx" ON "CourseScheduleChange"("courseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCompletion_courseId_key" ON "CourseCompletion"("courseId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseCompletion_workflowInstanceId_key" ON "CourseCompletion"("workflowInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseReportVersion_fileId_key" ON "CourseReportVersion"("fileId");

-- CreateIndex
CREATE UNIQUE INDEX "CourseReportVersion_courseId_version_key" ON "CourseReportVersion"("courseId", "version");

-- CreateIndex
CREATE INDEX "File_courseId_idx" ON "File"("courseId");

-- CreateIndex
CREATE INDEX "File_courseSessionId_idx" ON "File"("courseSessionId");

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "CourseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Course" ADD CONSTRAINT "Course_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTrainer" ADD CONSTRAINT "CourseTrainer_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseTrainer" ADD CONSTRAINT "CourseTrainer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseStaff" ADD CONSTRAINT "CourseStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseParticipant" ADD CONSTRAINT "CourseParticipant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSession" ADD CONSTRAINT "CourseSession_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSessionTrainer" ADD CONSTRAINT "CourseSessionTrainer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseSessionTrainer" ADD CONSTRAINT "CourseSessionTrainer_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "CourseTrainer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SessionAttendance" ADD CONSTRAINT "SessionAttendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CourseParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseScheduleChange" ADD CONSTRAINT "CourseScheduleChange_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseScheduleChange" ADD CONSTRAINT "CourseScheduleChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseScheduleChange" ADD CONSTRAINT "CourseScheduleChange_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseCompletion" ADD CONSTRAINT "CourseCompletion_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReportVersion" ADD CONSTRAINT "CourseReportVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReportVersion" ADD CONSTRAINT "CourseReportVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CourseReportVersion" ADD CONSTRAINT "CourseReportVersion_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Schedule change log is append-only
DROP TRIGGER IF EXISTS "CourseScheduleChange_immutable" ON "CourseScheduleChange";
CREATE TRIGGER "CourseScheduleChange_immutable" BEFORE UPDATE ON "CourseScheduleChange" FOR EACH ROW EXECUTE FUNCTION dya_block_change();
