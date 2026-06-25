-- CreateTable
CREATE TABLE "PostMeetingActionSync" (
    "id" TEXT NOT NULL,
    "actionHash" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "dueDate" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "clickupTaskId" TEXT NOT NULL,
    "clickupTaskName" TEXT NOT NULL,
    "clickupStatus" TEXT,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,

    CONSTRAINT "PostMeetingActionSync_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostMeetingActionSync_userId_clientId_actionHash_key" ON "PostMeetingActionSync"("userId", "clientId", "actionHash");

-- CreateIndex
CREATE UNIQUE INDEX "PostMeetingActionSync_userId_clickupTaskId_key" ON "PostMeetingActionSync"("userId", "clickupTaskId");

-- AddForeignKey
ALTER TABLE "PostMeetingActionSync" ADD CONSTRAINT "PostMeetingActionSync_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostMeetingActionSync" ADD CONSTRAINT "PostMeetingActionSync_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
