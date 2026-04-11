-- Migration: add_job_priority_to_profile_endpoint
-- Thêm field jobPriority vào ProfileEndpoint
-- Default MEDIUM cho tất cả records hiện có

ALTER TABLE "ProfileEndpoint" ADD COLUMN "jobPriority" TEXT NOT NULL DEFAULT 'MEDIUM';
