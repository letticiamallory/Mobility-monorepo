-- Run once against Postgres (synchronize is false in this project).
ALTER TABLE users
ADD COLUMN IF NOT EXISTS accompanied character varying(32) NOT NULL DEFAULT 'companied';
