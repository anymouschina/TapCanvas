-- Enable pass_through_body for packyapi channels.
--
-- Background:
--   new-api 的 /v1/responses 默认会把请求反序列化进 dto.OpenAIResponsesRequest，
--   再重新 Marshal 后发给上游（relay/responses_handler.go:83-137）。OpenClaw / Codex
--   等客户端发来的 Responses 请求里含有 DTO 没覆盖到的字段，重序列化后会被丢弃，
--   导致 packyapi 上游收到不完整 body 直接 502。开启 pass_through_body_enabled
--   后，原始 body 一字节不改地透传上游，恢复与「客户端直连 packyapi」一致的行为。
--
-- Match：按 base_url 命中所有 packyapi.com 渠道，避免依赖自增 id 与具体名称。
-- Idempotent：已经为 true 时跳过；与已有 setting JSON 做 merge，不覆盖其他字段。

UPDATE channels
SET setting = (
    COALESCE(NULLIF(setting, '')::jsonb, '{}'::jsonb)
    || '{"pass_through_body_enabled": true}'::jsonb
)::text
WHERE base_url LIKE '%packyapi.com%'
  AND COALESCE(
        (NULLIF(setting, '')::jsonb ->> 'pass_through_body_enabled')::boolean,
        false
      ) IS NOT TRUE;
