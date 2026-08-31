#!/bin/sh

set -eu

db_host="${NEW_API_PATCH_DB_HOST:-postgres}"
db_port="${NEW_API_PATCH_DB_PORT:-5432}"
db_name="${NEW_API_PATCH_DB_NAME:-tapcanvas_new_api}"
db_user="${NEW_API_PATCH_DB_USER:-tapcanvas}"

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

if [ "$database_exists" = "1" ]; then
	printf '[new-api-db-init] database already exists: %s\n' "$db_name"
	exit 0
fi

createdb \
	-h "$db_host" \
	-p "$db_port" \
	-U "$db_user" \
	--maintenance-db=postgres \
	"$db_name"

printf '[new-api-db-init] database created: %s\n' "$db_name"
