-- CreateTable
CREATE TABLE "QuickReply" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shortcut" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    CONSTRAINT "Conversation_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Conversation_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Conversation" ("assignedUserId", "closedAt", "contactId", "createdAt", "flowState", "id", "lastMessageAt", "sessionId", "status", "unreadCount") SELECT "assignedUserId", "closedAt", "contactId", "createdAt", "flowState", "id", "lastMessageAt", "sessionId", "status", "unreadCount" FROM "Conversation";
DROP TABLE "Conversation";
ALTER TABLE "new_Conversation" RENAME TO "Conversation";
CREATE INDEX "Conversation_sessionId_status_lastMessageAt_idx" ON "Conversation"("sessionId", "status", "lastMessageAt");
CREATE INDEX "Conversation_contactId_status_idx" ON "Conversation"("contactId", "status");
CREATE TABLE "new_Message" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "sessionId" INTEGER NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "waMessageId" TEXT,
    "direction" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "caption" TEXT,
    "author" TEXT,
    "mediaPath" TEXT,
    "mimeType" TEXT,
    "fileName" TEXT,
    "payload" JSONB,
    "sentByUserId" INTEGER,
    "timestamp" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Message_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Message" ("author", "body", "caption", "conversationId", "createdAt", "direction", "fileName", "id", "mediaPath", "mimeType", "origin", "payload", "sentByUserId", "sessionId", "timestamp", "type", "waMessageId") SELECT "author", "body", "caption", "conversationId", "createdAt", "direction", "fileName", "id", "mediaPath", "mimeType", "origin", "payload", "sentByUserId", "sessionId", "timestamp", "type", "waMessageId" FROM "Message";
DROP TABLE "Message";
ALTER TABLE "new_Message" RENAME TO "Message";
CREATE INDEX "Message_conversationId_id_idx" ON "Message"("conversationId", "id");
CREATE INDEX "Message_timestamp_idx" ON "Message"("timestamp");
CREATE UNIQUE INDEX "Message_sessionId_waMessageId_key" ON "Message"("sessionId", "waMessageId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "QuickReply_shortcut_key" ON "QuickReply"("shortcut");
