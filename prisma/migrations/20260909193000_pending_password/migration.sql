-- The password an admin set and the person has not used yet.
--
-- Readable on purpose, which the hash next to it deliberately is not. There is no reset
-- email and no self-service password change in this app: every password is handed over
-- by one person to another, so the one that gets lost is always the one that was set and
-- not yet delivered. That is the gap this closes, and it closes the moment the account
-- signs in — so what is stored here is only ever a credential nobody has used.
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "pending_password" TEXT;
ALTER TABLE "app_user" ADD COLUMN IF NOT EXISTS "pending_password_set_at" TIMESTAMP(3);
