-- each hotel connects its own booking inbox (OTA and travel-agent emails) and its own Gemini key; YHM reads new emails and adds bookings
ALTER TABLE `HotelSetting`
  ADD COLUMN `emailImportOn` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `mailUser` VARCHAR(191) NULL,
  ADD COLUMN `mailPass` TEXT NULL,
  ADD COLUMN `mailHost` VARCHAR(191) NULL,
  ADD COLUMN `mailPort` INTEGER NULL,
  ADD COLUMN `mailSenders` TEXT NULL,
  ADD COLUMN `geminiKey` TEXT NULL,
  ADD COLUMN `mailUidValidity` VARCHAR(191) NULL,
  ADD COLUMN `mailLastUid` INTEGER NULL,
  ADD COLUMN `mailCheckedAt` DATETIME(3) NULL,
  ADD COLUMN `mailError` TEXT NULL;

CREATE TABLE `EmailImport` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `messageId` VARCHAR(191) NOT NULL,
  `via` VARCHAR(191) NOT NULL DEFAULT 'EMAIL',
  `fromAddress` VARCHAR(191) NULL,
  `subject` VARCHAR(191) NULL,
  `receivedAt` DATETIME(3) NULL,
  `kind` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `channel` VARCHAR(191) NULL,
  `reference` VARCHAR(191) NULL,
  `message` TEXT NULL,
  `data` JSON NULL,
  `bookingIds` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `EmailImport_messageId_key`(`messageId`),
  INDEX `EmailImport_channel_reference_idx`(`channel`, `reference`),
  INDEX `EmailImport_status_idx`(`status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
