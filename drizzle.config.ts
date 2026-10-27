import { defineConfig } from 'drizzle-kit';

// In Docker: DATABASE_URL is injected via environment variables.
// In dev: load .env file if available (dotenv is optional).
try { require('dotenv').config(); } catch { /* dotenv not available in production — OK */ }

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL! },
});
