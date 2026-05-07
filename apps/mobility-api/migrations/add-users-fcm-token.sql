ALTER TABLE users
ADD COLUMN IF NOT EXISTS fcm_token character varying(255);
