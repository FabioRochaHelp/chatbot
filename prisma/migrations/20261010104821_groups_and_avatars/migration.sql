-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "avatarCheckedAt" DATETIME;
ALTER TABLE "Contact" ADD COLUMN "avatarPath" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Session" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "autoStart" BOOLEAN NOT NULL DEFAULT true,
    "botMode" TEXT NOT NULL DEFAULT 'off',
    "flowId" INTEGER,
    "aiAgentId" INTEGER,
    "lastState" TEXT,
    "acceptGroups" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Session_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Session_aiAgentId_fkey" FOREIGN KEY ("aiAgentId") REFERENCES "AiAgent" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Session" ("aiAgentId", "autoStart", "botMode", "createdAt", "engine", "flowId", "id", "lastState", "name", "updatedAt") SELECT "aiAgentId", "autoStart", "botMode", "createdAt", "engine", "flowId", "id", "lastState", "name", "updatedAt" FROM "Session";
DROP TABLE "Session";
ALTER TABLE "new_Session" RENAME TO "Session";
CREATE UNIQUE INDEX "Session_name_key" ON "Session"("name");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Grupos passam a ficar fora do Atendimento por padrão (acceptGroups = false):
-- encerra as conversas de grupo que estavam abertas na fila (o histórico é mantido).
UPDATE "Conversation"
SET "status" = 'closed', "closedAt" = CURRENT_TIMESTAMP, "flowState" = NULL
WHERE "status" <> 'closed'
  AND "contactId" IN (SELECT "id" FROM "Contact" WHERE "isGroup" = true);
