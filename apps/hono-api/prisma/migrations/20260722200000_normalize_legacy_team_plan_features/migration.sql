UPDATE "team_subscription_plans"
SET
  "features_json" = jsonb_build_object(
    'concurrent_tasks_per_seat', ("features_json"::jsonb ->> 'concurrent_tasks_per_seat')::integer,
    'unlimited_concurrent_tasks', FALSE,
    'canvas_collab', ("features_json"::jsonb ->> 'canvas_collab')::boolean,
    'shared_asset_library', ("features_json"::jsonb ->> 'shared_asset_library')::boolean,
    'seat_management', ("features_json"::jsonb ->> 'seat_management')::boolean,
    'credit_quota_control', ("features_json"::jsonb ->> 'credit_quota_control')::boolean,
    'fast_invoice', ("features_json"::jsonb ->> 'fast_invoice')::boolean,
    'creditGrants', jsonb_build_object(
      'monthly', jsonb_build_object(
        'includedCreditsPerSeat', "credits_per_seat_per_month",
        'firstPurchaseBonusCreditsPerSeat', 0
      ),
      'annual', jsonb_build_object(
        'includedCreditsPerSeat', "credits_per_seat_per_month" * 12,
        'firstPurchaseBonusCreditsPerSeat', 0
      )
    ),
    'presentation', ("features_json"::jsonb -> 'presentation') || jsonb_build_object(
      'variantOrder', 1
    )
  )::text,
  "updated_at" = NOW()::text
WHERE "id" IN ('plan_standard', 'plan_advanced', 'plan_pro', 'plan_premium');
