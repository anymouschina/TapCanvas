BEGIN;

UPDATE "team_subscription_plans"
SET
  "price_monthly_cents" = 0,
  "credits_per_seat_per_month" = 0,
  "features_json" = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE("features_json"::jsonb, '{}'::jsonb),
        '{creditGrants,monthly,includedCreditsPerSeat}',
        '0'::jsonb,
        true
      ),
      '{creditGrants,monthly,firstPurchaseBonusCreditsPerSeat}',
      '0'::jsonb,
      true
    ),
    '{presentation,compareAtMonthlyCents}',
    '0'::jsonb,
    true
  )::text,
  "updated_at" = NOW()::text
WHERE "id" IN (
  'neo_team_plus',
  'neo_team_plus_t2',
  'neo_team_plus_t3',
  'neo_team_pro',
  'neo_team_pro_t2',
  'neo_team_pro_t3',
  'neo_team_max',
  'neo_team_max_t2',
  'neo_team_ultra'
);

COMMIT;
