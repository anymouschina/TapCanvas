DO $$
BEGIN
  IF to_regclass('public."PromptSample"') IS NOT NULL THEN
    -- Drop existing FK (if created with cascade)
    EXECUTE 'ALTER TABLE "PromptSample" DROP CONSTRAINT IF EXISTS "PromptSample_userId_fkey"';

    -- Ensure updatedAt uses the application-managed timestamp (no DB default)
    BEGIN
      EXECUTE 'ALTER TABLE "PromptSample" ALTER COLUMN "updatedAt" DROP DEFAULT';
    EXCEPTION
      WHEN undefined_column THEN NULL;
    END;

    -- Recreate FK with RESTRICT semantics so deleting User won't delete samples silently
    EXECUTE 'ALTER TABLE "PromptSample" ADD CONSTRAINT "PromptSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE';
  END IF;
END $$;
