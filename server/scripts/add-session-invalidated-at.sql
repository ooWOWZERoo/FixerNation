-- Adds a column to site_users that records when a user's active sessions
-- were invalidated (e.g. when a school admin revokes their seat).
-- requireSiteAuth compares the JWT's iat against this timestamp and rejects
-- any token issued before the invalidation moment.
ALTER TABLE site_users
  ADD COLUMN IF NOT EXISTS session_invalidated_at DATETIME NULL DEFAULT NULL;
