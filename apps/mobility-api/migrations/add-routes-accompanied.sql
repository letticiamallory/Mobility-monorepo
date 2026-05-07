-- Run once against Postgres (synchronize is false in this project).
-- Equivalent to migration AddAccompaniedToRoutes1750000000000.
ALTER TABLE routes
ADD COLUMN IF NOT EXISTS accompanied character varying NOT NULL DEFAULT 'companied';
