-- CreateEnum
CREATE TYPE "AiArtifactType" AS ENUM ('WORKSPACE_SNAPSHOT', 'EXECUTIVE_BRIEF', 'CLIENT_SUMMARY', 'CONNECTOR_DIAGNOSIS');

-- CreateTable
CREATE TABLE "AiArtifact" (
    "id" TEXT NOT NULL,
    "type" "AiArtifactType" NOT NULL,
    "title" TEXT NOT NULL,
    "taskType" TEXT NOT NULL,
    "routerModel" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "promptTask" TEXT NOT NULL,
    "outputText" TEXT NOT NULL,
    "structuredData" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "AiArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiArtifact_userId_clientId_type_key" ON "AiArtifact"("userId", "clientId", "type");

-- AddForeignKey
ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiArtifact" ADD CONSTRAINT "AiArtifact_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
