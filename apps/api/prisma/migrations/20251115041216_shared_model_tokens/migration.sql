-- AlterTable
ALTER TABLE "ModelToken" ADD COLUMN     "shared" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sharedDisabledUntil" TIMESTAMP(3),
ADD COLUMN     "sharedFailureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sharedLastFailureAt" TIMESTAMP(3);
