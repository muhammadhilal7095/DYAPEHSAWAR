-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "designation" TEXT,
    "phone" TEXT,
    "districtId" TEXT,
    "departmentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" JSONB NOT NULL,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PasswordReset" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordReset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "District" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "type" TEXT NOT NULL DEFAULT 'DISTRICT',
    "region" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "District_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Counter" (
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Counter_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "SystemSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "LookupOption" (
    "id" TEXT NOT NULL,
    "group" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "meta" JSONB,

    CONSTRAINT "LookupOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowDefinition" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "districtId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "resubmitPolicy" TEXT NOT NULL DEFAULT 'RESTART',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowLevel" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "WorkflowLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkflowInstance" (
    "id" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "entityRef" TEXT NOT NULL,
    "definitionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'IN_PROGRESS',
    "currentLevelOrder" INTEGER,
    "currentAssigneeId" TEXT,
    "currentAssignedAt" TIMESTAMP(3),
    "returnedAtLevel" INTEGER,
    "cycle" INTEGER NOT NULL DEFAULT 1,
    "submittedById" TEXT NOT NULL,
    "districtId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkflowInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficerAssignment" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "levelId" TEXT,
    "levelOrder" INTEGER NOT NULL,
    "levelName" TEXT NOT NULL,
    "assigneeId" TEXT,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "outcome" TEXT,
    "reason" TEXT,

    CONSTRAINT "OfficerAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalHistory" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntityVersion" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntityVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "File" (
    "id" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'GENERAL',
    "caption" TEXT,
    "takenAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "locationSource" TEXT NOT NULL DEFAULT 'NONE',
    "exifTakenAt" TIMESTAMP(3),
    "exifLatitude" DOUBLE PRECISION,
    "exifLongitude" DOUBLE PRECISION,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),
    "activityRequestId" TEXT,
    "activityReportId" TEXT,
    "bookingId" TEXT,
    "jmReportId" TEXT,
    "jmAssetId" TEXT,
    "jmActionId" TEXT,

    CONSTRAINT "File_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailLog" (
    "id" TEXT NOT NULL,
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
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
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
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityRequest" (
    "id" TEXT NOT NULL,
    "daamrId" TEXT NOT NULL,
    "requesterId" TEXT NOT NULL,
    "requesteeEmail" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "departmentId" TEXT,
    "category" TEXT,
    "subject" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "venue" TEXT NOT NULL,
    "proposedBudget" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "executionStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "approvedAt" TIMESTAMP(3),
    "workflowInstanceId" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityReport" (
    "id" TEXT NOT NULL,
    "reportNo" TEXT NOT NULL,
    "daamrId" TEXT NOT NULL,
    "requestId" TEXT,
    "activityDate" TIMESTAMP(3) NOT NULL,
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
    "submittedAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ActivityReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityParticipant" (
    "id" TEXT NOT NULL,
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

    CONSTRAINT "ActivityParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActivityBudget" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "allocated" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "utilized" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "remaining" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "fundSource" TEXT,
    "remarks" TEXT,

    CONSTRAINT "ActivityBudget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaLink" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT NOT NULL,

    CONSTRAINT "MediaLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "FacilityType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hostel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "facilityTypeId" TEXT,
    "managerId" TEXT,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPERATIONAL',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hostel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL,
    "hostelId" TEXT NOT NULL,
    "roomNumber" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "notes" TEXT,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HostelBooking" (
    "id" TEXT NOT NULL,
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
    "requestedCheckIn" TIMESTAMP(3) NOT NULL,
    "requestedCheckOut" TIMESTAMP(3) NOT NULL,
    "approvedCheckIn" TIMESTAMP(3),
    "approvedCheckOut" TIMESTAMP(3),
    "requesterRemarks" TEXT,
    "hqRemarks" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "stayStatus" TEXT NOT NULL DEFAULT 'NONE',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "workflowInstanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "HostelBooking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingGuest" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cnicEnc" TEXT,
    "cnicMasked" TEXT,
    "gender" TEXT,

    CONSTRAINT "BookingGuest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoomReservation" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),

    CONSTRAINT "RoomReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StayRecord" (
    "id" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "checkInAt" TIMESTAMP(3) NOT NULL,
    "checkInById" TEXT NOT NULL,
    "actualGuests" INTEGER NOT NULL,
    "actualRooms" INTEGER NOT NULL,
    "idVerified" BOOLEAN NOT NULL DEFAULT false,
    "checkInRemarks" TEXT,
    "checkOutAt" TIMESTAMP(3),
    "checkOutById" TEXT,
    "finalGuests" INTEGER,
    "finalRooms" INTEGER,
    "checkOutRemarks" TEXT,
    "earlyDeparture" BOOLEAN NOT NULL DEFAULT false,
    "extendedTo" TIMESTAMP(3),

    CONSTRAINT "StayRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmAsset" (
    "id" TEXT NOT NULL,
    "assetCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "projectStartDate" TIMESTAMP(3),
    "plannedCompletionDate" TIMESTAMP(3),
    "revisedCompletionDate" TIMESTAMP(3),
    "approvedCost" DOUBLE PRECISION,
    "contractor" TEXT,
    "supervisingDepartment" TEXT,
    "supervisingOfficer" TEXT,
    "currentStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "overallProgress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastInspectionDate" TIMESTAMP(3),
    "lastReportingDate" TIMESTAMP(3),
    "remarks" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JmAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmReport" (
    "id" TEXT NOT NULL,
    "reportNo" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "districtId" TEXT NOT NULL,
    "reportingOfficerId" TEXT NOT NULL,
    "reportingOfficerEmail" TEXT NOT NULL,
    "periodFrom" TIMESTAMP(3) NOT NULL,
    "periodTo" TIMESTAMP(3) NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "inspectionType" TEXT NOT NULL,
    "projectStatus" TEXT NOT NULL,
    "currentProgress" DOUBLE PRECISION NOT NULL,
    "previousProgress" DOUBLE PRECISION,
    "progressDuringPeriod" DOUBLE PRECISION,
    "plannedProgress" DOUBLE PRECISION,
    "actualCompletion" DOUBLE PRECISION,
    "expectedCompletionDate" TIMESTAMP(3),
    "revisedCompletionDate" TIMESTAMP(3),
    "delayDays" INTEGER,
    "scheduleClass" TEXT NOT NULL DEFAULT 'NOT_APPLICABLE',
    "progressDiscrepancy" BOOLEAN NOT NULL DEFAULT false,
    "completedSummary" TEXT,
    "plannedSummary" TEXT,
    "expectedNextProgress" DOUBLE PRECISION,
    "qualityRating" TEXT NOT NULL DEFAULT 'NOT_ASSESSED',
    "qualityRemarks" TEXT,
    "defectsIdentified" TEXT,
    "workmanshipObservations" TEXT,
    "materialObservations" TEXT,
    "qualityCorrectiveActions" TEXT,
    "qualityCorrectiveDeadline" TIMESTAMP(3),
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
    "recommendedCompletionDate" TIMESTAMP(3),
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "nextInspectionDate" TIMESTAMP(3),
    "certName" TEXT,
    "certDesignation" TEXT,
    "certStatement" TEXT,
    "certifiedAt" TIMESTAMP(3),
    "finalReviewerId" TEXT,
    "finalDecisionAt" TIMESTAMP(3),
    "finalReviewerNote" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "workflowInstanceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JmReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmCompletedActivity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "completionDate" TIMESTAMP(3),
    "quantity" TEXT,
    "wasPlanned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "JmCompletedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmPlannedActivity" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "milestone" TEXT,
    "responsible" TEXT,
    "resources" TEXT,

    CONSTRAINT "JmPlannedActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmIssue" (
    "id" TEXT NOT NULL,
    "issueCode" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "dateIdentified" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "responsible" TEXT,
    "recommendedAction" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionRemarks" TEXT,
    "impactNote" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JmIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmAction" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "assetId" TEXT NOT NULL,
    "issueId" TEXT,
    "description" TEXT NOT NULL,
    "actionType" TEXT NOT NULL,
    "responsible" TEXT,
    "dateAssigned" TIMESTAMP(3),
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completionRemarks" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JmAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmRisk" (
    "id" TEXT NOT NULL,
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
    "reviewDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JmRisk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JmMitigation" (
    "id" TEXT NOT NULL,
    "riskId" TEXT NOT NULL,
    "measures" TEXT NOT NULL,
    "preventiveActions" TEXT,
    "responsible" TEXT,
    "resources" TEXT,
    "targetDate" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "effectiveness" TEXT,

    CONSTRAINT "JmMitigation_pkey" PRIMARY KEY ("id")
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

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PasswordReset" ADD CONSTRAINT "PasswordReset_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Department" ADD CONSTRAINT "Department_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowDefinition" ADD CONSTRAINT "WorkflowDefinition_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLevel" ADD CONSTRAINT "WorkflowLevel_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLevel" ADD CONSTRAINT "WorkflowLevel_approverUserId_fkey" FOREIGN KEY ("approverUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowLevel" ADD CONSTRAINT "WorkflowLevel_approverRoleId_fkey" FOREIGN KEY ("approverRoleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "WorkflowDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_currentAssigneeId_fkey" FOREIGN KEY ("currentAssigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkflowInstance" ADD CONSTRAINT "WorkflowInstance_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerAssignment" ADD CONSTRAINT "OfficerAssignment_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerAssignment" ADD CONSTRAINT "OfficerAssignment_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "WorkflowLevel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerAssignment" ADD CONSTRAINT "OfficerAssignment_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficerAssignment" ADD CONSTRAINT "OfficerAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalHistory" ADD CONSTRAINT "ApprovalHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntityVersion" ADD CONSTRAINT "EntityVersion_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_activityRequestId_fkey" FOREIGN KEY ("activityRequestId") REFERENCES "ActivityRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_activityReportId_fkey" FOREIGN KEY ("activityReportId") REFERENCES "ActivityReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_jmReportId_fkey" FOREIGN KEY ("jmReportId") REFERENCES "JmReport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_jmAssetId_fkey" FOREIGN KEY ("jmAssetId") REFERENCES "JmAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "File" ADD CONSTRAINT "File_jmActionId_fkey" FOREIGN KEY ("jmActionId") REFERENCES "JmAction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailLog" ADD CONSTRAINT "EmailLog_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRequest" ADD CONSTRAINT "ActivityRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRequest" ADD CONSTRAINT "ActivityRequest_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRequest" ADD CONSTRAINT "ActivityRequest_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityRequest" ADD CONSTRAINT "ActivityRequest_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReport" ADD CONSTRAINT "ActivityReport_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "ActivityRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReport" ADD CONSTRAINT "ActivityReport_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReport" ADD CONSTRAINT "ActivityReport_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReport" ADD CONSTRAINT "ActivityReport_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityReport" ADD CONSTRAINT "ActivityReport_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityParticipant" ADD CONSTRAINT "ActivityParticipant_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityBudget" ADD CONSTRAINT "ActivityBudget_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaLink" ADD CONSTRAINT "MediaLink_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ActivityReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_facilityTypeId_fkey" FOREIGN KEY ("facilityTypeId") REFERENCES "FacilityType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hostel" ADD CONSTRAINT "Hostel_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBooking" ADD CONSTRAINT "HostelBooking_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBooking" ADD CONSTRAINT "HostelBooking_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBooking" ADD CONSTRAINT "HostelBooking_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBooking" ADD CONSTRAINT "HostelBooking_hostelId_fkey" FOREIGN KEY ("hostelId") REFERENCES "Hostel"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HostelBooking" ADD CONSTRAINT "HostelBooking_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingGuest" ADD CONSTRAINT "BookingGuest_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoomReservation" ADD CONSTRAINT "RoomReservation_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRecord" ADD CONSTRAINT "StayRecord_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HostelBooking"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRecord" ADD CONSTRAINT "StayRecord_checkInById_fkey" FOREIGN KEY ("checkInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StayRecord" ADD CONSTRAINT "StayRecord_checkOutById_fkey" FOREIGN KEY ("checkOutById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmAsset" ADD CONSTRAINT "JmAsset_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmReport" ADD CONSTRAINT "JmReport_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmReport" ADD CONSTRAINT "JmReport_districtId_fkey" FOREIGN KEY ("districtId") REFERENCES "District"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmReport" ADD CONSTRAINT "JmReport_reportingOfficerId_fkey" FOREIGN KEY ("reportingOfficerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmReport" ADD CONSTRAINT "JmReport_finalReviewerId_fkey" FOREIGN KEY ("finalReviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmReport" ADD CONSTRAINT "JmReport_workflowInstanceId_fkey" FOREIGN KEY ("workflowInstanceId") REFERENCES "WorkflowInstance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmCompletedActivity" ADD CONSTRAINT "JmCompletedActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmPlannedActivity" ADD CONSTRAINT "JmPlannedActivity_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmIssue" ADD CONSTRAINT "JmIssue_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmIssue" ADD CONSTRAINT "JmIssue_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmAction" ADD CONSTRAINT "JmAction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmAction" ADD CONSTRAINT "JmAction_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmAction" ADD CONSTRAINT "JmAction_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "JmIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmAction" ADD CONSTRAINT "JmAction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmRisk" ADD CONSTRAINT "JmRisk_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "JmReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmRisk" ADD CONSTRAINT "JmRisk_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "JmAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JmMitigation" ADD CONSTRAINT "JmMitigation_riskId_fkey" FOREIGN KEY ("riskId") REFERENCES "JmRisk"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only enforcement for audit log and approval history
-- PostgreSQL equivalent of the SQLite triggers in the initial migration:
-- audit log and approval history rows are append-only.
CREATE OR REPLACE FUNCTION dya_block_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "AuditLog_immutable" ON "AuditLog";
CREATE TRIGGER "AuditLog_immutable" BEFORE UPDATE OR DELETE ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION dya_block_change();
DROP TRIGGER IF EXISTS "ApprovalHistory_immutable" ON "ApprovalHistory";
CREATE TRIGGER "ApprovalHistory_immutable" BEFORE UPDATE OR DELETE ON "ApprovalHistory" FOR EACH ROW EXECUTE FUNCTION dya_block_change();
