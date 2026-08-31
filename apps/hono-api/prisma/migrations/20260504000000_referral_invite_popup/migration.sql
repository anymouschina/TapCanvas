-- Add referral fields to users
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invite_code" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referrer_user_id" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "referrer_bound_at" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "idx_users_invite_code" ON "users" ("invite_code");
CREATE INDEX IF NOT EXISTS "idx_users_referrer_user_id" ON "users" ("referrer_user_id");

-- Referral campaign configuration (single row, id=1)
CREATE TABLE IF NOT EXISTS "referral_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "enabled" INTEGER NOT NULL DEFAULT 0,
    "title" TEXT NOT NULL DEFAULT '邀请好友，长期返佣',
    "body" TEXT NOT NULL DEFAULT '好友每次充值你都得返佣，长期有效',
    "cta_text" TEXT NOT NULL DEFAULT '复制我的邀请链接',
    "image_url" TEXT,
    "first_recharge_bonus_credits" INTEGER NOT NULL DEFAULT 50,
    "recharge_credits_per_yuan" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "min_recharge_yuan_for_bonus" DOUBLE PRECISION NOT NULL DEFAULT 10,
    "anti_self_check" INTEGER NOT NULL DEFAULT 1,
    "anti_self_window_days" INTEGER NOT NULL DEFAULT 30,
    "total_cap_credits_per_referrer" INTEGER NOT NULL DEFAULT 100000,
    "updated_at" TEXT NOT NULL,
    CONSTRAINT "referral_config_pkey" PRIMARY KEY ("id")
);

-- Referral bonus grant log (idempotency + audit)
CREATE TABLE IF NOT EXISTS "referral_grant_log" (
    "id" TEXT NOT NULL,
    "source_topup_ledger_id" TEXT NOT NULL,
    "referrer_user_id" TEXT NOT NULL,
    "invitee_user_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "granted_credits" INTEGER NOT NULL,
    "ledger_entry_id" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    CONSTRAINT "referral_grant_log_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "referral_grant_log_source_topup_ledger_id_referrer_user_id_kind_key"
    ON "referral_grant_log" ("source_topup_ledger_id", "referrer_user_id", "kind");
CREATE INDEX IF NOT EXISTS "idx_referral_grant_log_referrer"
    ON "referral_grant_log" ("referrer_user_id", "created_at");
