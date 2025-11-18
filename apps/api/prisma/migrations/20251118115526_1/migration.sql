/*
  Warnings:

  - Made the column `ownerId` on table `Asset` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Asset" DROP CONSTRAINT "Asset_ownerId_fkey";

-- AlterTable
ALTER TABLE "Asset" ALTER COLUMN "ownerId" SET NOT NULL;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "VideoGenerationHistory" ADD COLUMN     "generationId" TEXT,
ADD COLUMN     "postId" TEXT;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
