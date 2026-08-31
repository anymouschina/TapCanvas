-- Add invitee welcome bonus to referral_config (default 100 credits)
ALTER TABLE "referral_config" ADD COLUMN IF NOT EXISTS "invitee_welcome_credits" INTEGER NOT NULL DEFAULT 100;
