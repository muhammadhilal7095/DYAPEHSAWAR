-- CreateTable
CREATE TABLE "Course" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "dailyStartTime" TEXT,
    "dailyEndTime" TEXT,
    "registeredCount" INTEGER NOT NULL DEFAULT 0,
    "coordinatorId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AWAITING_START',
    "startedAt" DATETIME,
    "completedAt" DATETIME,
    "startNotifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Course_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ActivityRequest" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Course_coordinatorId_fkey" FOREIGN KEY ("coordinatorId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseTrainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "expertise" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseTrainer_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseTrainer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseStaff" (
    "courseId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'STAFF',

    PRIMARY KEY ("courseId", "userId"),
    CONSTRAINT "CourseStaff_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "registrationNo" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" TEXT,
    "institution" TEXT,
    "contact" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseParticipant_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "dayNumber" INTEGER NOT NULL,
    "sessionDate" DATETIME NOT NULL,
    "originalDate" DATETIME NOT NULL,
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
    "submittedAt" DATETIME,
    "verifiedAt" DATETIME,
    "verifiedById" TEXT,
    "updatedById" TEXT,
    "reportDueNotifiedAt" DATETIME,
    "dayNotifiedAt" DATETIME,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseSession_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseSession_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseSession_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseSessionTrainer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "trainerId" TEXT,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "isGuest" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "CourseSessionTrainer_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseSessionTrainer_trainerId_fkey" FOREIGN KEY ("trainerId") REFERENCES "CourseTrainer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionAttendance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "participantId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remarks" TEXT,
    CONSTRAINT "SessionAttendance_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SessionAttendance_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "CourseParticipant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseScheduleChange" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "sessionId" TEXT,
    "changeType" TEXT NOT NULL,
    "fromDate" DATETIME,
    "toDate" DATETIME,
    "reason" TEXT NOT NULL,
    "byId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseScheduleChange_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseScheduleChange_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "CourseSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "CourseScheduleChange_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseCompletion" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "submittedAt" DATETIME,
    "approvedAt" DATETIME,
    "approvedById" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourseCompletion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseCompletion_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourseReportVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "courseId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "fileId" TEXT NOT NULL,
    "reason" TEXT,
    "generatedById" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourseReportVersion_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CourseReportVersion_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "CourseReportVersion_generatedById_fkey" FOREIGN KEY ("generatedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
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
    "courseId" TEXT,
    "courseSessionId" TEXT,
    "description" TEXT,
    "featured" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "File_activityAssignmentId_fkey" FOREIGN KEY ("activityAssignmentId") REFERENCES "ActivityAssignment" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_courseSessionId_fkey" FOREIGN KEY ("courseSessionId") REFERENCES "CourseSession" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_activityRequestId_fkey" FOREIGN KEY ("activityRequestId") REFERENCES "ActivityRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_activityReportId_fkey" FOREIGN KEY ("activityReportId") REFERENCES "ActivityReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmReportId_fkey" FOREIGN KEY ("jmReportId") REFERENCES "JmReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmAssetId_fkey" FOREIGN KEY ("jmAssetId") REFERENCES "JmAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmActionId_fkey" FOREIGN KEY ("jmActionId") REFERENCES "JmAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_File" ("activityAssignmentId", "activityReportId", "activityRequestId", "bookingId", "caption", "category", "createdAt", "deletedAt", "exifLatitude", "exifLongitude", "exifTakenAt", "id", "jmActionId", "jmAssetId", "jmReportId", "kind", "latitude", "locationSource", "longitude", "mimeType", "originalName", "sha256", "size", "storedName", "takenAt", "uploadedById") SELECT "activityAssignmentId", "activityReportId", "activityRequestId", "bookingId", "caption", "category", "createdAt", "deletedAt", "exifLatitude", "exifLongitude", "exifTakenAt", "id", "jmActionId", "jmAssetId", "jmReportId", "kind", "latitude", "locationSource", "longitude", "mimeType", "originalName", "sha256", "size", "storedName", "takenAt", "uploadedById" FROM "File";
DROP TABLE "File";
ALTER TABLE "new_File" RENAME TO "File";
CREATE UNIQUE INDEX "File_storedName_key" ON "File"("storedName");
CREATE INDEX "File_activityRequestId_idx" ON "File"("activityRequestId");
CREATE INDEX "File_activityReportId_idx" ON "File"("activityReportId");
CREATE INDEX "File_bookingId_idx" ON "File"("bookingId");
CREATE INDEX "File_jmReportId_idx" ON "File"("jmReportId");
CREATE INDEX "File_jmAssetId_idx" ON "File"("jmAssetId");
CREATE INDEX "File_activityAssignmentId_idx" ON "File"("activityAssignmentId");
CREATE INDEX "File_courseId_idx" ON "File"("courseId");
CREATE INDEX "File_courseSessionId_idx" ON "File"("courseSessionId");
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
    "activityType" TEXT NOT NULL DEFAULT 'EVENT',
    "trainingDays" INTEGER,
    "deliveryFormat" TEXT,
    "methodology" TEXT,
    "proposedTrainers" JSONB,
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
INSERT INTO "new_ActivityRequest" ("approvedAt", "area", "category", "completedAt", "createdAt", "daamrId", "departmentId", "description", "districtId", "endDate", "endTime", "executionStatus", "expectedParticipants", "id", "lifecycle", "objectives", "priority", "proposedBudget", "province", "requesteeEmail", "requesterId", "startDate", "startTime", "status", "subject", "submittedAt", "targetAudience", "tehsil", "updatedAt", "updatedById", "venue", "venueAddress", "version", "workflowInstanceId") SELECT "approvedAt", "area", "category", "completedAt", "createdAt", "daamrId", "departmentId", "description", "districtId", "endDate", "endTime", "executionStatus", "expectedParticipants", "id", "lifecycle", "objectives", "priority", "proposedBudget", "province", "requesteeEmail", "requesterId", "startDate", "startTime", "status", "subject", "submittedAt", "targetAudience", "tehsil", "updatedAt", "updatedById", "venue", "venueAddress", "version", "workflowInstanceId" FROM "ActivityRequest";
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


-- Schedule change log is append-only
CREATE TRIGGER "CourseScheduleChange_no_update" BEFORE UPDATE ON "CourseScheduleChange" BEGIN SELECT RAISE(ABORT, 'Schedule change records are immutable'); END;
