-- DropForeignKey
ALTER TABLE "PromptSample" DROP CONSTRAINT "PromptSample_userId_fkey";

-- AlterTable
ALTER TABLE "PromptSample" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AddForeignKey
ALTER TABLE "PromptSample" ADD CONSTRAINT "PromptSample_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
