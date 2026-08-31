-- A submission boundary that is proven not to have reached the provider is
-- retryable graph work, not a terminal failure. `stale` keeps the prior
-- evidence visible while placing the node back on the DAG ready frontier.
UPDATE authoring_artifacts
SET status = 'stale',
    updated_at = NOW()::text
WHERE artifact_key LIKE 'video-submission:%'
  AND status = 'failed'
  AND payload IS NOT NULL
  AND payload::jsonb ->> 'kind' IN (
    'structured_pre_upstream_rejection',
    'explicit_replacement_authorized'
  )
  AND payload::jsonb ->> 'providerRequestAttempted' = 'false'
  AND payload::jsonb ->> 'providerAccepted' = 'false';
