#!/bin/sh

set -eu

log() {
	printf '[new-api-patch] %s\n' "$*"
}

die() {
	printf '[new-api-patch] ERROR: %s\n' "$*" >&2
	exit 1
}

patch_root="${NEW_API_PATCH_ROOT:-/patches}"
patch_mode="${NEW_API_PATCH_MODE:-apply}"
db_host="${NEW_API_PATCH_DB_HOST:-postgres}"
db_port="${NEW_API_PATCH_DB_PORT:-5432}"
db_name="${NEW_API_PATCH_DB_NAME:-tapcanvas_new_api}"
db_user="${NEW_API_PATCH_DB_USER:-tapcanvas}"
gemini_base_url="${NEW_API_GEMINI_BASE_URL:-}"

psql_db() {
	psql -X -v ON_ERROR_STOP=1 \
		-h "$db_host" \
		-p "$db_port" \
		-U "$db_user" \
		-d "$db_name" \
		"$@"
}

run_patch() {
	patch_file="$1"
	if [ -n "$gemini_base_url" ]; then
		psql_db -v gemini_base_url="$gemini_base_url" -f "$patch_file"
		return
	fi
	psql_db -f "$patch_file"
}

record_failure() {
	patch_filename="$1"
	psql_db \
		-v patch_filename="$patch_filename" \
		-f - <<'SQL' >/dev/null 2>&1 || true
INSERT INTO schema_patch_failures (filename, failed_at, attempt_count)
VALUES (:'patch_filename', NOW(), 1)
ON CONFLICT (filename) DO UPDATE
SET failed_at = EXCLUDED.failed_at,
    attempt_count = schema_patch_failures.attempt_count + 1;
SQL
}

record_deferral() {
	patch_filename="$1"
	reason="$2"
	psql_db \
		-v patch_filename="$patch_filename" \
		-v reason="$reason" \
		-f - <<'SQL' >/dev/null
INSERT INTO schema_patch_deferrals (
  filename,
  reason,
  first_deferred_at,
  last_deferred_at,
  attempt_count
)
VALUES (:'patch_filename', :'reason', NOW(), NOW(), 1)
ON CONFLICT (filename) DO UPDATE
SET reason = EXCLUDED.reason,
    last_deferred_at = EXCLUDED.last_deferred_at,
    attempt_count = schema_patch_deferrals.attempt_count + 1;
SQL
}

record_success() {
	patch_filename="$1"
	psql_db \
		-v patch_filename="$patch_filename" \
		-f - <<'SQL' >/dev/null
BEGIN;
INSERT INTO schema_migrations (filename)
VALUES (:'patch_filename')
ON CONFLICT DO NOTHING;
DELETE FROM schema_patch_deferrals WHERE filename = :'patch_filename';
DELETE FROM schema_patch_failures WHERE filename = :'patch_filename';
COMMIT;
SQL
}

reconcile_unconfigured_channels() {
	# A channel without an actual credential is configuration-only. Keeping it
	# enabled would publish an endpoint that cannot execute. This is a structural
	# invariant, independent of any provider or model name.
	issue_names="$(psql_db -tAc "
SELECT COALESCE(string_agg(name, ', ' ORDER BY name), '')
FROM channels
WHERE btrim(COALESCE(key, '')) = ''
   OR left(btrim(COALESCE(key, '')), 12) = 'PLACEHOLDER_'
   OR btrim(COALESCE(key, '')) IN (
     'YOUR_COMFLY_API_KEY',
     'RUNNINGHUB_API_KEY',
     'ACCESS_KEY|SECRET_KEY'
   );
")"

	psql_db -c "
BEGIN;
WITH unconfigured AS (
  SELECT id
  FROM channels
  WHERE btrim(COALESCE(key, '')) = ''
     OR left(btrim(COALESCE(key, '')), 12) = 'PLACEHOLDER_'
     OR btrim(COALESCE(key, '')) IN (
       'YOUR_COMFLY_API_KEY',
       'RUNNINGHUB_API_KEY',
       'ACCESS_KEY|SECRET_KEY'
     )
), disabled_channels AS (
  UPDATE channels AS channel
  SET status = 2,
      key = CASE
        WHEN left(btrim(COALESCE(channel.key, '')), 12) = 'PLACEHOLDER_'
          OR btrim(COALESCE(channel.key, '')) IN (
            'YOUR_COMFLY_API_KEY',
            'RUNNINGHUB_API_KEY',
            'ACCESS_KEY|SECRET_KEY'
          )
        THEN ''
        ELSE COALESCE(channel.key, '')
      END
  FROM unconfigured
  WHERE channel.id = unconfigured.id
    AND (
      channel.status <> 2
      OR left(btrim(COALESCE(channel.key, '')), 12) = 'PLACEHOLDER_'
      OR btrim(COALESCE(channel.key, '')) IN (
        'YOUR_COMFLY_API_KEY',
        'RUNNINGHUB_API_KEY',
        'ACCESS_KEY|SECRET_KEY'
      )
      OR channel.key IS NULL
    )
  RETURNING channel.id
)
UPDATE abilities AS ability
SET enabled = FALSE
FROM channels AS channel
WHERE ability.channel_id = channel.id
  AND channel.status <> 1
  AND ability.enabled = TRUE;
COMMIT;
" >/dev/null

	if [ -n "$issue_names" ]; then
		log "configuration-only channels are explicitly disabled: $issue_names"
	else
		log "all configured channels have non-empty credentials"
	fi
}

if [ "${NEW_API_PATCH_ENABLED:-1}" != "1" ]; then
	log "patch execution explicitly disabled by NEW_API_PATCH_ENABLED=${NEW_API_PATCH_ENABLED:-}"
	exit 0
fi

case "$patch_mode" in
	apply|reconcile) ;;
	*) die "NEW_API_PATCH_MODE must be apply or reconcile, got: $patch_mode" ;;
esac

[ -d "$patch_root" ] || die "patch root does not exist: $patch_root"

database_exists="$(
	psql -X -v ON_ERROR_STOP=1 \
		-h "$db_host" \
		-p "$db_port" \
		-U "$db_user" \
		-d postgres \
		-v database_name="$db_name" \
		-tA -f - <<'SQL'
SELECT 1 FROM pg_database WHERE datname = :'database_name';
SQL
)"
[ "$database_exists" = "1" ] || die "database $db_name does not exist; run new-api-schema-init first"

schema_ready="$(psql_db -tAc "
SELECT CASE WHEN
  to_regclass('public.channels') IS NOT NULL
  AND to_regclass('public.abilities') IS NOT NULL
  AND to_regclass('public.models') IS NOT NULL
  AND to_regclass('public.vendors') IS NOT NULL
  AND to_regclass('public.options') IS NOT NULL
THEN 1 ELSE 0 END;
")"
[ "$schema_ready" = "1" ] || die "new-api schema is incomplete; run new-api-schema-init first"

psql_db -c "
CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS schema_patch_deferrals (
  filename TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  first_deferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_deferred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS schema_patch_failures (
  filename TEXT PRIMARY KEY,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempt_count INTEGER NOT NULL DEFAULT 1
);
" >/dev/null

# Repair state left by older deployments before later patches inspect active
# routes. No real credential is changed; only empty/placeholder credentials are
# cleared and disabled.
reconcile_unconfigured_channels

if [ "$patch_mode" = "reconcile" ]; then
	log "credential reconciliation completed"
	exit 0
fi

found_patch=0
applied=0
skipped=0
skipped_conflicts=0
deferred=0

for patch in $(find "$patch_root" -type f -name '*.sql' | sort); do
	found_patch=1
	rel="${patch#"$patch_root"/}"
	already="$(psql_db -v patch_filename="$rel" -tA -f - <<'SQL'
SELECT COUNT(1)
FROM schema_migrations
WHERE filename = :'patch_filename';
SQL
)"
	if [ "$already" = "1" ]; then
		log "skip (already applied): $rel"
		skipped=$((skipped + 1))
		continue
	fi

	log "apply: $rel"
	patch_log="/tmp/new-api-patch.$$.log"
	patch_ok="/tmp/new-api-patch.$$.ok"
	rm -f "$patch_log" "$patch_ok"

	# POSIX sh has no PIPESTATUS. The marker captures psql's exit status while
	# tee keeps the complete SQL output visible in deployment logs.
	{ run_patch "$patch" 2>&1 && : > "$patch_ok"; } | tee "$patch_log"
	if [ ! -f "$patch_ok" ]; then
		if grep -Eq 'duplicate key value violates unique constraint|SQLSTATE[^[:alnum:]]*23505|Code:[[:space:]]*23505' "$patch_log"; then
			log "WARNING: compatibility conflict in patch $rel; skipped safely (transaction rolled back; no existing row was overwritten)"
			skipped_conflicts=$((skipped_conflicts + 1))
			rm -f "$patch_log"
			continue
		fi
		record_failure "$rel"
		rm -f "$patch_log"
		die "patch failed: $rel"
	fi
	rm -f "$patch_ok"

	if grep -Fq 'PATCH_DEFERRED:' "$patch_log"; then
		reason="$(sed -n 's/^.*PATCH_DEFERRED:[[:space:]]*//p' "$patch_log" | tail -n 1)"
		[ -n "$reason" ] || reason="optional prerequisite is not configured"
		record_deferral "$rel" "$reason"
		log "deferred: $rel ($reason)"
		deferred=$((deferred + 1))
	else
		record_success "$rel"
		log "applied: $rel"
		applied=$((applied + 1))
	fi
	rm -f "$patch_log"
done

[ "$found_patch" = "1" ] || die "no SQL patches found under $patch_root"

# Enforce the invariant again for channels created by this patch run.
reconcile_unconfigured_channels

log "done: applied=$applied skipped=$skipped skipped_conflicts=$skipped_conflicts deferred=$deferred"
if [ "$deferred" -gt 0 ]; then
	log "deferred patches remain queryable in schema_patch_deferrals and will retry on the next deployment"
	psql_db -c "
SELECT filename, reason, last_deferred_at, attempt_count
FROM schema_patch_deferrals
ORDER BY filename;
"
fi
