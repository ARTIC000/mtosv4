-- CreateTable
CREATE TABLE "MtosScoreSnapshot" (
    "id" TEXT NOT NULL,
    "health" INTEGER NOT NULL,
    "risk" INTEGER NOT NULL,
    "upsellReadiness" INTEGER NOT NULL,
    "factors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "MtosScoreSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MtosScoreSnapshot_userId_clientId_createdAt_idx" ON "MtosScoreSnapshot"("userId", "clientId", "createdAt");

-- AddForeignKey
ALTER TABLE "MtosScoreSnapshot" ADD CONSTRAINT "MtosScoreSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MtosScoreSnapshot" ADD CONSTRAINT "MtosScoreSnapshot_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
