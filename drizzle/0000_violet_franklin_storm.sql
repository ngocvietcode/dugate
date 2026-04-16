CREATE TABLE "ApiKey" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"keyHash" text NOT NULL,
	"prefix" text NOT NULL,
	"role" text DEFAULT 'STANDARD' NOT NULL,
	"note" text,
	"spendingLimit" double precision DEFAULT 0 NOT NULL,
	"totalUsed" double precision DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ApiKey_keyHash_unique" UNIQUE("keyHash")
);
--> statement-breakpoint
CREATE TABLE "AppSetting" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" text NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "AppSetting_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "ExternalApiConnection" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"endpointUrl" text NOT NULL,
	"httpMethod" text DEFAULT 'POST' NOT NULL,
	"authType" text DEFAULT 'API_KEY_HEADER' NOT NULL,
	"authKeyHeader" text DEFAULT 'x-api-key' NOT NULL,
	"authSecret" text NOT NULL,
	"promptFieldName" text DEFAULT 'query' NOT NULL,
	"fileFieldName" text DEFAULT 'files' NOT NULL,
	"fileUrlFieldName" text,
	"defaultPrompt" text NOT NULL,
	"staticFormFields" text,
	"extraHeaders" text,
	"responseContentPath" text DEFAULT 'content',
	"sessionIdResponsePath" text,
	"sessionIdFieldName" text,
	"timeoutSec" integer DEFAULT 60 NOT NULL,
	"state" text DEFAULT 'ENABLED' NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "ExternalApiConnection_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ExternalApiOverride" (
	"id" text PRIMARY KEY NOT NULL,
	"connectionId" text NOT NULL,
	"apiKeyId" text NOT NULL,
	"endpointSlug" text NOT NULL,
	"stepId" text DEFAULT '_default' NOT NULL,
	"promptOverride" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "FileCache" (
	"id" text PRIMARY KEY NOT NULL,
	"md5Hash" text NOT NULL,
	"s3Key" text NOT NULL,
	"fileName" text NOT NULL,
	"mimeType" text NOT NULL,
	"size" integer NOT NULL,
	"refCount" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"lastAccessedAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	CONSTRAINT "FileCache_md5Hash_unique" UNIQUE("md5Hash")
);
--> statement-breakpoint
CREATE TABLE "Operation" (
	"id" text PRIMARY KEY NOT NULL,
	"apiKeyId" text,
	"createdByUserId" text,
	"idempotencyKey" text,
	"done" boolean DEFAULT false NOT NULL,
	"state" text DEFAULT 'RUNNING' NOT NULL,
	"progressPercent" integer DEFAULT 0 NOT NULL,
	"progressMessage" text,
	"endpointSlug" text,
	"pipelineJson" text NOT NULL,
	"currentStep" integer DEFAULT 0 NOT NULL,
	"failedAtStep" integer,
	"filesJson" text,
	"outputFormat" text DEFAULT 'json' NOT NULL,
	"outputContent" text,
	"outputFilePath" text,
	"extractedData" text,
	"stepsResultJson" text,
	"totalInputTokens" integer DEFAULT 0 NOT NULL,
	"totalOutputTokens" integer DEFAULT 0 NOT NULL,
	"pagesProcessed" integer DEFAULT 0 NOT NULL,
	"modelUsed" text,
	"totalCostUsd" double precision DEFAULT 0 NOT NULL,
	"usageBreakdown" text,
	"webhookUrl" text,
	"webhookSentAt" timestamp (3),
	"errorCode" text,
	"errorMessage" text,
	"filesDeleted" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	"deletedAt" timestamp (3),
	CONSTRAINT "Operation_idempotencyKey_unique" UNIQUE("idempotencyKey")
);
--> statement-breakpoint
CREATE TABLE "ProfileEndpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"apiKeyId" text NOT NULL,
	"endpointSlug" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"parameters" text,
	"connectionsOverride" text,
	"jobPriority" text DEFAULT 'MEDIUM' NOT NULL,
	"fileUrlAuthConfig" text,
	"allowedFileExtensions" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "UserProfileAssignment" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"apiKeyId" text NOT NULL,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'USER' NOT NULL,
	"provider" text,
	"providerSub" text,
	"email" text,
	"displayName" text,
	"createdAt" timestamp (3) DEFAULT CURRENT_TIMESTAMP(3) NOT NULL,
	"updatedAt" timestamp (3) NOT NULL,
	CONSTRAINT "User_username_unique" UNIQUE("username"),
	CONSTRAINT "User_providerSub_unique" UNIQUE("providerSub")
);
--> statement-breakpoint
CREATE INDEX "apikey_status_idx" ON "ApiKey" USING btree ("status");--> statement-breakpoint
CREATE INDEX "ext_conn_slug_idx" ON "ExternalApiConnection" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ext_conn_state_idx" ON "ExternalApiConnection" USING btree ("state");--> statement-breakpoint
CREATE UNIQUE INDEX "ext_override_unique_idx" ON "ExternalApiOverride" USING btree ("connectionId","apiKeyId","endpointSlug","stepId");--> statement-breakpoint
CREATE INDEX "ext_override_apiKeyId_idx" ON "ExternalApiOverride" USING btree ("apiKeyId");--> statement-breakpoint
CREATE INDEX "ext_override_connectionId_idx" ON "ExternalApiOverride" USING btree ("connectionId");--> statement-breakpoint
CREATE INDEX "ext_override_endpointSlug_idx" ON "ExternalApiOverride" USING btree ("endpointSlug");--> statement-breakpoint
CREATE INDEX "file_cache_refCount_idx" ON "FileCache" USING btree ("refCount");--> statement-breakpoint
CREATE INDEX "file_cache_lastAccessedAt_idx" ON "FileCache" USING btree ("lastAccessedAt");--> statement-breakpoint
CREATE INDEX "operation_state_idx" ON "Operation" USING btree ("state");--> statement-breakpoint
CREATE INDEX "operation_apiKeyId_createdAt_idx" ON "Operation" USING btree ("apiKeyId","createdAt");--> statement-breakpoint
CREATE INDEX "operation_createdAt_idx" ON "Operation" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "operation_endpointSlug_idx" ON "Operation" USING btree ("endpointSlug");--> statement-breakpoint
CREATE UNIQUE INDEX "profile_endpoint_unique_idx" ON "ProfileEndpoint" USING btree ("apiKeyId","endpointSlug");--> statement-breakpoint
CREATE INDEX "profile_endpoint_apiKeyId_idx" ON "ProfileEndpoint" USING btree ("apiKeyId");--> statement-breakpoint
CREATE UNIQUE INDEX "user_profile_assignment_unique_idx" ON "UserProfileAssignment" USING btree ("userId","apiKeyId");--> statement-breakpoint
CREATE INDEX "user_profile_assignment_userId_idx" ON "UserProfileAssignment" USING btree ("userId");--> statement-breakpoint
CREATE INDEX "user_profile_assignment_apiKeyId_idx" ON "UserProfileAssignment" USING btree ("apiKeyId");