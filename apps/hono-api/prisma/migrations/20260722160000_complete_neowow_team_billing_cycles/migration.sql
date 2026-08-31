-- NeoWow team plans support both billing cycles. The annual compare-at values
-- are twelve months of the regular monthly prices; the previous seed retained
-- those values but accidentally left price_monthly_cents at zero.
INSERT INTO "team_subscription_plans" (
  "id",
  "name",
  "tier",
  "price_monthly_cents",
  "price_annual_cents",
  "credits_per_seat_per_month",
  "max_seats",
  "min_seats",
  "features_json",
  "sort_weight",
  "enabled",
  "created_at",
  "updated_at"
)
VALUES
  (
    'neo_team_plus',
    'PLUS',
    'PLUS',
    9580,
    87000,
    7983,
    5,
    5,
    '{"concurrent_tasks_per_seat":2,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true,"presentation":{"badge":"5 席团队","compareAtMonthlyCents":0,"compareAtAnnualCents":114960,"accent":"graphite","featured":false,"campaignBenefits":["固定 5 个团队协作席位","团队资产与个人资产相互隔离"],"capabilities":["多人实时协作画布与团队项目权限","团队席位和生成额度统一管理","团队共享角色卡、参考图与项目资产","小T 与 Agents 基于团队项目上下文协作","图片、视频与分镜节点统一执行","章节分镜与视频生产链路","作品发布到 Neo TV 并展示创作过程"]}}',
    10,
    1,
    NOW()::text,
    NOW()::text
  ),
  (
    'neo_team_pro',
    'PRO',
    'PRO',
    15290,
    133800,
    12742,
    10,
    10,
    '{"concurrent_tasks_per_seat":4,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true,"presentation":{"badge":"10 席团队","compareAtMonthlyCents":0,"compareAtAnnualCents":183480,"accent":"violet","featured":true,"campaignBenefits":["固定 10 个团队协作席位","团队资产与个人资产相互隔离"],"capabilities":["多人实时协作画布与团队项目权限","团队席位和生成额度统一管理","团队共享角色卡、参考图与项目资产","小T 与 Agents 基于团队项目上下文协作","图片、视频与分镜节点统一执行","章节分镜与视频生产链路","作品发布到 Neo TV 并展示创作过程"]}}',
    20,
    1,
    NOW()::text,
    NOW()::text
  ),
  (
    'neo_team_max',
    'MAX',
    'MAX',
    34450,
    290000,
    28708,
    20,
    20,
    '{"concurrent_tasks_per_seat":8,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true,"presentation":{"badge":"20 席团队","compareAtMonthlyCents":0,"compareAtAnnualCents":413400,"accent":"blue","featured":false,"campaignBenefits":["固定 20 个团队协作席位","团队资产与个人资产相互隔离"],"capabilities":["多人实时协作画布与团队项目权限","团队席位和生成额度统一管理","团队共享角色卡、参考图与项目资产","小T 与 Agents 基于团队项目上下文协作","图片、视频与分镜节点统一执行","章节分镜与视频生产链路","作品发布到 Neo TV 并展示创作过程"]}}',
    30,
    1,
    NOW()::text,
    NOW()::text
  ),
  (
    'neo_team_ultra',
    'ULTRA',
    'ULTRA',
    36132,
    300000,
    30110,
    50,
    50,
    '{"concurrent_tasks_per_seat":16,"canvas_collab":true,"shared_asset_library":true,"seat_management":true,"credit_quota_control":true,"fast_invoice":true,"presentation":{"badge":"50 席团队","compareAtMonthlyCents":0,"compareAtAnnualCents":433584,"accent":"cyan","featured":false,"campaignBenefits":["固定 50 个团队协作席位","团队资产与个人资产相互隔离"],"capabilities":["多人实时协作画布与团队项目权限","团队席位和生成额度统一管理","团队共享角色卡、参考图与项目资产","小T 与 Agents 基于团队项目上下文协作","图片、视频与分镜节点统一执行","章节分镜与视频生产链路","作品发布到 Neo TV 并展示创作过程"]}}',
    40,
    1,
    NOW()::text,
    NOW()::text
  )
ON CONFLICT ("id") DO UPDATE SET
  "name" = EXCLUDED."name",
  "tier" = EXCLUDED."tier",
  "price_monthly_cents" = EXCLUDED."price_monthly_cents",
  "price_annual_cents" = EXCLUDED."price_annual_cents",
  "credits_per_seat_per_month" = EXCLUDED."credits_per_seat_per_month",
  "max_seats" = EXCLUDED."max_seats",
  "min_seats" = EXCLUDED."min_seats",
  "features_json" = EXCLUDED."features_json",
  "sort_weight" = EXCLUDED."sort_weight",
  "enabled" = EXCLUDED."enabled",
  "updated_at" = EXCLUDED."updated_at";
