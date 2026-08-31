DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "assets"
    WHERE "project_id" IS NULL
      AND ("data"::jsonb ->> 'kind') = 'projectFsState'
    GROUP BY "owner_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce one active project directory per owner: duplicate directory assets exist';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "uq_assets_owner_active_project_directory"
  ON "assets" ("owner_id")
  WHERE "project_id" IS NULL
    AND ("data"::jsonb ->> 'kind') = 'projectFsState';

DO $$
BEGIN
  IF (
    SELECT COUNT(*)
    FROM pg_index AS index_metadata
    JOIN pg_class AS index_relation
      ON index_relation.oid = index_metadata.indexrelid
    JOIN pg_namespace AS index_namespace
      ON index_namespace.oid = index_relation.relnamespace
    JOIN pg_am AS access_method
      ON access_method.oid = index_relation.relam
    WHERE index_namespace.nspname = 'public'
      AND index_relation.relname = 'uq_assets_owner_active_project_directory'
      AND index_metadata.indrelid = 'public.assets'::regclass
      AND index_metadata.indisunique
      AND index_metadata.indisvalid
      AND index_metadata.indisready
      AND access_method.amname = 'btree'
      AND index_metadata.indnkeyatts = 1
      AND index_metadata.indnatts = 1
      AND pg_get_indexdef(index_metadata.indexrelid, 1, TRUE) = 'owner_id'
      AND pg_get_expr(index_metadata.indpred, index_metadata.indrelid) =
        '((project_id IS NULL) AND (((data)::jsonb ->> ''kind''::text) = ''projectFsState''::text))'
  ) <> 1 THEN
    RAISE EXCEPTION
      'Existing uq_assets_owner_active_project_directory index does not match the required contract';
  END IF;
END $$;
