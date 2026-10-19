-- CreateTable
CREATE TABLE "Department" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'esteira',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "DepartmentUser" (
    "departmentId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "lastAssignedAt" DATETIME,

    PRIMARY KEY ("departmentId", "userId"),
    CONSTRAINT "DepartmentUser_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DepartmentUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiAgent" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-opus-5',
    "effort" TEXT NOT NULL DEFAULT 'low',
    "instructions" TEXT NOT NULL DEFAULT '',
    "knowledge" TEXT NOT NULL DEFAULT '',
    "historyMessages" INTEGER NOT NULL DEFAULT 20,
    "maxRepliesPerHour" INTEGER NOT NULL DEFAULT 20,
    "handoffDepartmentId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiAgent_handoffDepartmentId_fkey" FOREIGN KEY ("handoffDepartmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_AiAgent" ("createdAt", "effort", "historyMessages", "id", "instructions", "knowledge", "maxRepliesPerHour", "model", "name", "updatedAt") SELECT "createdAt", "effort", "historyMessages", "id", "instructions", "knowledge", "maxRepliesPerHour", "model", "name", "updatedAt" FROM "AiAgent";
DROP TABLE "AiAgent";
ALTER TABLE "new_AiAgent" RENAME TO "AiAgent";
CREATE TABLE "new_Conversation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'bot',
    "assignedUserId" INTEGER,
    "flowState" JSONB,
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" DATETIME,
    "departmentId" INTEGER,
    "queuedAt" DATETIME,
    CONSTRAINT "Conversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Conversation_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("assignedUserId", "closedAt", "contactId", "createdAt", "flowState", "id", "lastMessageAt", "sessionId", "status", "unreadCount") SELECT "assignedUserId", "closedAt", "contactId", "createdAt", "flowState", "id", "lastMessageAt", "sessionId", "status", "unreadCount" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_sessionId_status_lastMessageAt_idx" ON "Conversation"("sessionId", "status", "lastMessageAt");
CREATE INDEX "Conversation_contactId_status_idx" ON "Conversation"("contactId", "status");
CREATE INDEX "Conversation_departmentId_status_queuedAt_idx" ON "Conversation"("departmentId", "status", "queuedAt");
CREATE TABLE "new_User" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'agent',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "tokenVersion" INTEGER NOT NULL DEFAULT 0,
    "lastLoginAt" DATETIME,
    "available" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("active", "createdAt", "email", "id", "lastLoginAt", "name", "passwordHash", "role", "tokenVersion", "updatedAt") SELECT "active", "createdAt", "email", "id", "lastLoginAt", "name", "passwordHash", "role", "tokenVersion", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Department_name_key" ON "Department"("name");

-- CreateIndex
CREATE INDEX "DepartmentUser_userId_idx" ON "DepartmentUser"("userId");


-- conversas que já estavam na fila: entram na fila "Sem departamento" pela última mensagem
UPDATE "Conversation" SET "queuedAt" = "lastMessageAt" WHERE "status" = 'pending';
