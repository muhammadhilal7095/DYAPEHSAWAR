-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "districtId" TEXT,
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" DATETIME,
    "lastLoginAt" DATETIME,
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "User_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    PRIMARY KEY ("userId", "roleId"),
    CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" DATETIME NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DISTRICT',
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "districtId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Department_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" INTEGER NOT NULL DEFAULT 0
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL PRIMARY KEY,
    "value" JSONB NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT
);

-- CreateTable
CREATE TABLE "LookupOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "districtId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resubmitPolicy" TEXT NOT NULL DEFAULT 'RESTART',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowDefinition_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowLevel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "definitionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "designation" TEXT,
    "approverType" TEXT NOT NULL DEFAULT 'ROLE',
    "approverUserId" TEXT,
    "approverRoleId" TEXT,
    "districtScope" TEXT NOT NULL DEFAULT 'ANY',
    "allowReject" BOOLEAN NOT NULL DEFAULT true,
    "allowReturn" BOOLEAN NOT NULL DEFAULT true,
    "allowReassign" BOOLEAN NOT NULL DEFAULT false,
    "canAmendDates" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "WorkflowLevel_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkflowLevel_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowLevel_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "Role" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "module" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentLevelOrder" INTEGER,
    "currentAssigneeId" TEXT,
    "currentAssignedAt" DATETIME,
    "returnedAtLevel" INTEGER,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT NOT NULL,
    "districtId" TEXT,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WorkflowInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkflowInstance_currentAssigneeId_fkey" FOREIGN KEY ("currentAssigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "WorkflowInstance_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WorkflowInstance_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "OfficerAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "levelId" TEXT,
    "levelOrder" INTEGER NOT NULL,
    "levelName" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outcome" TEXT,
    "reason" TEXT,
    CONSTRAINT "OfficerAssignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "OfficerAssignment_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "WorkflowLevel" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OfficerAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "OfficerAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ApprovalHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT NOT NULL,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "levelOrder" INTEGER,
    "levelName" TEXT,
    "action" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "actorDesignation" TEXT,
    "targetUserId" TEXT,
    "targetUserName" TEXT,
    "remarks" TEXT,
    "data" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ApprovalHistory_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ApprovalHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EntityVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "instanceId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EntityVersion_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "File" (
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
    CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "File_activityRequestId_fkey" FOREIGN KEY ("activityRequestId") REFERENCES "ActivityRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_activityReportId_fkey" FOREIGN KEY ("activityReportId") REFERENCES "ActivityReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmReportId_fkey" FOREIGN KEY ("jmReportId") REFERENCES "JmReport" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmAssetId_fkey" FOREIGN KEY ("jmAssetId") REFERENCES "JmAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "File_jmActionId_fkey" FOREIGN KEY ("jmActionId") REFERENCES "JmAction" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "module" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "toEmail" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "module" TEXT,
    "entityRef" TEXT,
    "instanceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "messageId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" DATETIME,
    "sentAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "module" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityRef" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityRequest" (
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

-- CreateTable
CREATE TABLE "ActivityReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportNo" TEXT NOT NULL,
    "daamrId" TEXT NOT NULL,
    "requestId" TEXT,
    "activityDate" DATETIME NOT NULL,
    "districtId" TEXT NOT NULL,
    "departmentId" TEXT,
    "activityName" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "venue" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "responsibleOfficer" TEXT NOT NULL,
    "activityStatus" TEXT NOT NULL DEFAULT 'COMPLETED',
    "remarks" TEXT,
    "reportStatus" TEXT NOT NULL DEFAULT 'DRAFT',
    "workflowInstanceId" TEXT,
    "createdById" TEXT NOT NULL,
    "updatedById" TEXT,
    "submittedAt" DATETIME,
    "verifiedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ActivityReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ActivityRequest" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityReport_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityReport_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ActivityReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ActivityReport_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "male" INTEGER NOT NULL DEFAULT 0,
    "female" INTEGER NOT NULL DEFAULT 0,
    "minority" INTEGER NOT NULL DEFAULT 0,
    "madaris" INTEGER NOT NULL DEFAULT 0,
    "transgender" INTEGER NOT NULL DEFAULT 0,
    "disabled" INTEGER NOT NULL DEFAULT 0,
    "juvenile" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "countingRule" JSONB NOT NULL,
    CONSTRAINT "ActivityParticipant_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ActivityBudget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "allocated" REAL NOT NULL DEFAULT 0,
    "utilized" REAL NOT NULL DEFAULT 0,
    "remaining" REAL NOT NULL DEFAULT 0,
    "fundSource" TEXT,
    "remarks" TEXT,
    CONSTRAINT "ActivityBudget_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MediaLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    CONSTRAINT "MediaLink_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FacilityType" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true
);

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "facilityTypeId" TEXT,
    "managerId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Hostel_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Hostel_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Hostel_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hostelId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,
    CONSTRAINT "Room_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HostelBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesterEmail" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "roomType" TEXT,
    "guestName" TEXT NOT NULL,
    "cnicEnc" TEXT NOT NULL,
    "cnicMasked" TEXT NOT NULL,
    "mobile" TEXT NOT NULL,
    "organization" TEXT NOT NULL,
    "referredBy" TEXT,
    "referrerDesignation" TEXT,
    "purpose" TEXT NOT NULL,
    "numGuests" INTEGER NOT NULL,
    "numRooms" INTEGER NOT NULL,
    "requestedCheckIn" DATETIME NOT NULL,
    "requestedCheckOut" DATETIME NOT NULL,
    "approvedCheckIn" DATETIME,
    "approvedCheckOut" DATETIME,
    "requesterRemarks" TEXT,
    "hqRemarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "stayStatus" TEXT NOT NULL DEFAULT 'NONE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" DATETIME,
    "approvedById" TEXT,
    "approvedAt" DATETIME,
    "declinedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancelReason" TEXT,
    "workflowInstanceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "HostelBooking_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HostelBooking_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "HostelBooking_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HostelBooking_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "HostelBooking_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BookingGuest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnicEnc" TEXT,
    "cnicMasked" TEXT,
    "gender" TEXT,
    CONSTRAINT "BookingGuest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomReservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" DATETIME NOT NULL,
    "endDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" DATETIME,
    CONSTRAINT "RoomReservation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomReservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "StayRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "checkInAt" DATETIME NOT NULL,
    "checkInById" TEXT NOT NULL,
    "actualGuests" INTEGER NOT NULL,
    "actualRooms" INTEGER NOT NULL,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "checkInRemarks" TEXT,
    "checkOutAt" DATETIME,
    "checkOutById" TEXT,
    "finalGuests" INTEGER,
    "finalRooms" INTEGER,
    "checkOutRemarks" TEXT,
    "earlyDeparture" BOOLEAN NOT NULL DEFAULT false,
    "extendedTo" DATETIME,
    CONSTRAINT "StayRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "StayRecord_checkInById_fkey" FOREIGN KEY ("checkInById") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "StayRecord_checkOutById_fkey" FOREIGN KEY ("checkOutById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmAsset" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "projectStartDate" DATETIME,
    "plannedCompletionDate" DATETIME,
    "revisedCompletionDate" DATETIME,
    "approvedCost" REAL,
    "contractor" TEXT,
    "supervisingDepartment" TEXT,
    "supervisingOfficer" TEXT,
    "currentStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "overallProgress" REAL NOT NULL DEFAULT 0,
    "lastInspectionDate" DATETIME,
    "lastReportingDate" DATETIME,
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JmAsset_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmReport" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportNo" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "reportingOfficerId" TEXT NOT NULL,
    "reportingOfficerEmail" TEXT NOT NULL,
    "periodFrom" DATETIME NOT NULL,
    "periodTo" DATETIME NOT NULL,
    "inspectionDate" DATETIME NOT NULL,
    "inspectionType" TEXT NOT NULL,
    "projectStatus" TEXT NOT NULL,
    "currentProgress" REAL NOT NULL,
    "previousProgress" REAL,
    "progressDuringPeriod" REAL,
    "plannedProgress" REAL,
    "actualCompletion" REAL,
    "expectedCompletionDate" DATETIME,
    "revisedCompletionDate" DATETIME,
    "delayDays" INTEGER,
    "scheduleClass" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "progressDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "completedSummary" TEXT,
    "plannedSummary" TEXT,
    "expectedNextProgress" REAL,
    "qualityRating" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "qualityRemarks" TEXT,
    "defectsIdentified" TEXT,
    "workmanshipObservations" TEXT,
    "materialObservations" TEXT,
    "qualityCorrectiveActions" TEXT,
    "qualityCorrectiveDeadline" DATETIME,
    "complianceRating" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "applicableStandards" TEXT,
    "complianceObservations" TEXT,
    "deviations" TEXT,
    "complianceCorrective" TEXT,
    "complianceVerification" TEXT,
    "complianceChecklist" JSONB,
    "generalRemarks" TEXT,
    "officerRemarks" TEXT,
    "supervisorRemarks" TEXT,
    "additionalObs" TEXT,
    "impactDescription" TEXT,
    "scheduleImpact" TEXT,
    "qualityImpact" TEXT,
    "costImpact" TEXT,
    "operationalImpact" TEXT,
    "impactDelayDays" INTEGER,
    "impactSeverity" TEXT,
    "overallAssessment" TEXT,
    "keyFindings" TEXT,
    "recommendedMeasures" TEXT,
    "priorityActions" TEXT,
    "recommendedDepartment" TEXT,
    "recommendedCompletionDate" DATETIME,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "nextInspectionDate" DATETIME,
    "certName" TEXT,
    "certDesignation" TEXT,
    "certStatement" TEXT,
    "certifiedAt" DATETIME,
    "finalReviewerId" TEXT,
    "finalDecisionAt" DATETIME,
    "finalReviewerNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" DATETIME,
    "workflowInstanceId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JmReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JmReport_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JmReport_reportingOfficerId_fkey" FOREIGN KEY ("reportingOfficerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JmReport_finalReviewerId_fkey" FOREIGN KEY ("finalReviewerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JmReport_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmCompletedActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "completionDate" DATETIME,
    "quantity" TEXT,
    "wasPlanned" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "JmCompletedActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmPlannedActivity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedDate" DATETIME,
    "milestone" TEXT,
    "responsible" TEXT,
    "resources" TEXT,
    CONSTRAINT "JmPlannedActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmIssue" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "issueCode" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dateIdentified" DATETIME NOT NULL,
    "severity" TEXT NOT NULL,
    "responsible" TEXT,
    "recommendedAction" TEXT,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionRemarks" TEXT,
    "impactNote" TEXT,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JmIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JmIssue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmAction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "issueId" TEXT,
    "description" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "responsible" TEXT,
    "dateAssigned" DATETIME,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completionRemarks" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JmAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JmAction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "JmAction_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "JmIssue" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "JmAction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmRisk" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riskCode" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "probability" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "level" TEXT NOT NULL,
    "consequences" TEXT,
    "responsible" TEXT,
    "reviewDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "JmRisk_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "JmRisk_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "JmMitigation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "riskId" TEXT NOT NULL,
    "measures" TEXT NOT NULL,
    "preventiveActions" TEXT,
    "responsible" TEXT,
    "resources" TEXT,
    "targetDate" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "effectiveness" TEXT,
    CONSTRAINT "JmMitigation_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "JmRisk" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PasswordReset_tokenHash_key" ON "PasswordReset"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "District_name_key" ON "District"("name");

-- CreateIndex
CREATE UNIQUE INDEX "District_code_key" ON "District"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_districtId_key" ON "Department"("name", "districtId");

-- CreateIndex
CREATE INDEX "LookupOption_group_idx" ON "LookupOption"("group");

-- CreateIndex
CREATE UNIQUE INDEX "LookupOption_group_value_key" ON "LookupOption"("group", "value");

-- CreateIndex
CREATE INDEX "WorkflowDefinition_module_isActive_idx" ON "WorkflowDefinition"("module", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "WorkflowLevel_definitionId_order_key" ON "WorkflowLevel"("definitionId", "order");

-- CreateIndex
CREATE INDEX "WorkflowInstance_currentAssigneeId_status_idx" ON "WorkflowInstance"("currentAssigneeId", "status");

-- CreateIndex
CREATE INDEX "WorkflowInstance_module_status_idx" ON "WorkflowInstance"("module", "status");

-- CreateIndex
CREATE INDEX "OfficerAssignment_assigneeId_status_idx" ON "OfficerAssignment"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "OfficerAssignment_instanceId_idx" ON "OfficerAssignment"("instanceId");

-- CreateIndex
CREATE INDEX "ApprovalHistory_instanceId_createdAt_idx" ON "ApprovalHistory"("instanceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EntityVersion_entityType_entityId_version_key" ON "EntityVersion"("entityType", "entityId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "File_storedName_key" ON "File"("storedName");

-- CreateIndex
CREATE INDEX "File_activityRequestId_idx" ON "File"("activityRequestId");

-- CreateIndex
CREATE INDEX "File_activityReportId_idx" ON "File"("activityReportId");

-- CreateIndex
CREATE INDEX "File_bookingId_idx" ON "File"("bookingId");

-- CreateIndex
CREATE INDEX "File_jmReportId_idx" ON "File"("jmReportId");

-- CreateIndex
CREATE INDEX "File_jmAssetId_idx" ON "File"("jmAssetId");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "EmailLog_status_idx" ON "EmailLog"("status");

-- CreateIndex
CREATE INDEX "EmailLog_entityRef_idx" ON "EmailLog"("entityRef");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRequest_daamrId_key" ON "ActivityRequest"("daamrId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityRequest_workflowInstanceId_key" ON "ActivityRequest"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "ActivityRequest_status_idx" ON "ActivityRequest"("status");

-- CreateIndex
CREATE INDEX "ActivityRequest_districtId_idx" ON "ActivityRequest"("districtId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReport_reportNo_key" ON "ActivityReport"("reportNo");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReport_requestId_key" ON "ActivityReport"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityReport_workflowInstanceId_key" ON "ActivityReport"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "ActivityReport_daamrId_idx" ON "ActivityReport"("daamrId");

-- CreateIndex
CREATE INDEX "ActivityReport_districtId_activityDate_idx" ON "ActivityReport"("districtId", "activityDate");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityParticipant_reportId_key" ON "ActivityParticipant"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "ActivityBudget_reportId_key" ON "ActivityBudget"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "FacilityType_name_key" ON "FacilityType"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Hostel_name_key" ON "Hostel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Room_hostelId_roomNumber_key" ON "Room"("hostelId", "roomNumber");

-- CreateIndex
CREATE UNIQUE INDEX "HostelBooking_bookingId_key" ON "HostelBooking"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "HostelBooking_workflowInstanceId_key" ON "HostelBooking"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "HostelBooking_hostelId_status_idx" ON "HostelBooking"("hostelId", "status");

-- CreateIndex
CREATE INDEX "HostelBooking_status_idx" ON "HostelBooking"("status");

-- CreateIndex
CREATE INDEX "RoomReservation_roomId_status_startDate_endDate_idx" ON "RoomReservation"("roomId", "status", "startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "StayRecord_bookingId_key" ON "StayRecord"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "JmAsset_assetCode_key" ON "JmAsset"("assetCode");

-- CreateIndex
CREATE UNIQUE INDEX "JmAsset_name_key" ON "JmAsset"("name");

-- CreateIndex
CREATE UNIQUE INDEX "JmReport_reportNo_key" ON "JmReport"("reportNo");

-- CreateIndex
CREATE UNIQUE INDEX "JmReport_workflowInstanceId_key" ON "JmReport"("workflowInstanceId");

-- CreateIndex
CREATE INDEX "JmReport_assetId_status_idx" ON "JmReport"("assetId", "status");

-- CreateIndex
CREATE INDEX "JmReport_status_submittedAt_idx" ON "JmReport"("status", "submittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "JmIssue_issueCode_key" ON "JmIssue"("issueCode");

-- CreateIndex
CREATE UNIQUE INDEX "JmRisk_riskCode_key" ON "JmRisk"("riskCode");

-- Append-only enforcement: audit and approval history rows can never be modified or removed.
CREATE TRIGGER "AuditLog_no_update" BEFORE UPDATE ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'Audit log entries are immutable'); END;
CREATE TRIGGER "AuditLog_no_delete" BEFORE DELETE ON "AuditLog" BEGIN SELECT RAISE(ABORT, 'Audit log entries are immutable'); END;
CREATE TRIGGER "ApprovalHistory_no_update" BEFORE UPDATE ON "ApprovalHistory" BEGIN SELECT RAISE(ABORT, 'Approval history is immutable'); END;
CREATE TRIGGER "ApprovalHistory_no_delete" BEFORE DELETE ON "ApprovalHistory" BEGIN SELECT RAISE(ABORT, 'Approval history is immutable'); END;
