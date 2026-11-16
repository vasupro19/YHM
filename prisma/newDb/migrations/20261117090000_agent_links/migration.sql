-- travel agencies the hotel lets see live availability and send booking requests (e.g. from Travelytics)
CREATE TABLE `AgentLink` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `agencyName` VARCHAR(191) NOT NULL,
  `contact` VARCHAR(191) NULL,
  `keyHash` VARCHAR(191) NOT NULL,
  `keyHint` VARCHAR(191) NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `lastUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE INDEX `AgentLink_keyHash_key`(`keyHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Booking` ADD COLUMN `agentLinkId` INTEGER NULL,
  ADD COLUMN `agentRef` VARCHAR(191) NULL;
CREATE INDEX `Booking_agentLinkId_idx` ON `Booking`(`agentLinkId`);
