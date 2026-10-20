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

DROP TRIGGER IF EXISTS "CourseScheduleChange_immutable" ON "CourseScheduleChange";
CREATE TRIGGER "CourseScheduleChange_immutable" BEFORE UPDATE ON "CourseScheduleChange" FOR EACH ROW EXECUTE FUNCTION dya_block_change();
