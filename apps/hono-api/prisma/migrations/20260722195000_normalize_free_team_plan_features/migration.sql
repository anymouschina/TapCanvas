UPDATE "team_subscription_plans"
SET
  "features_json" = jsonb_build_object(
    'concurrent_tasks_per_seat', 0,
    'unlimited_concurrent_tasks', FALSE,
    'canvas_collab', FALSE,
    'shared_asset_library', FALSE,
    'seat_management', FALSE,
    'credit_quota_control', FALSE,
    'fast_invoice', FALSE,
    'creditGrants', jsonb_build_object(
      'monthly', jsonb_build_object(
        'includedCreditsPerSeat', 0,
        'firstPurchaseBonusCreditsPerSeat', 0
      ),
      'annual', jsonb_build_object(
        'includedCreditsPerSeat', 0,
        'firstPurchaseBonusCreditsPerSeat', 0
      )
    ),
    'presentation', jsonb_build_object(
      'badge', '免费版',
      'variantOrder', 1,
      'compareAtMonthlyCents', 0,
      'compareAtAnnualCents', 0,
      'accent', 'graphite',
      'featured', FALSE,
      'campaignBenefits', jsonb_build_array(),
      'capabilities', jsonb_build_array()
    )
  )::text,
  "updated_at" = NOW()::text
WHERE "id" = 'plan_free';
