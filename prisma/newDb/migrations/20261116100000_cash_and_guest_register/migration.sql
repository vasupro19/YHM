-- owner's daily summary
ALTER TABLE `HotelSetting` ADD COLUMN `ownerPhone` VARCHAR(191) NULL,
  ADD COLUMN `ownerEmail` VARCHAR(191) NULL,
  ADD COLUMN `summaryTime` VARCHAR(191) NOT NULL DEFAULT '22:00',
  ADD COLUMN `lastSummaryOn` VARCHAR(191) NULL;

-- guest register: details the police register and Form C ask for
ALTER TABLE `Customer` ADD COLUMN `nationality` VARCHAR(191) NULL,
  ADD COLUMN `gender` VARCHAR(191) NULL,
  ADD COLUMN `dob` DATE NULL,
  ADD COLUMN `careOf` VARCHAR(191) NULL,
  ADD COLUMN `foreignDetails` JSON NULL,
  ADD COLUMN `idFront` VARCHAR(191) NULL,
  ADD COLUMN `idBack` VARCHAR(191) NULL;

ALTER TABLE `Booking` ADD COLUMN `comingFrom` VARCHAR(191) NULL,
  ADD COLUMN `goingTo` VARCHAR(191) NULL,
  ADD COLUMN `purpose` VARCHAR(191) NULL,
  ADD COLUMN `otherGuests` TEXT NULL,
  ADD COLUMN `precheckinAt` DATETIME(3) NULL,
  ADD COLUMN `formCSubmittedAt` DATETIME(3) NULL,
  ADD COLUMN `formCRef` VARCHAR(191) NULL;

-- cash drawer: each close counts the cash a person took since their last close
CREATE TABLE `CashClose` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `userName` VARCHAR(191) NULL,
  `closedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `expected` DECIMAL(12, 2) NOT NULL,
  `counted` DECIMAL(12, 2) NOT NULL,
  `difference` DECIMAL(12, 2) NOT NULL,
  `paymentCount` INTEGER NOT NULL DEFAULT 0,
  `note` TEXT NULL,
  INDEX `CashClose_userId_closedAt_idx`(`userId`, `closedAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `Payment` ADD COLUMN `cashCloseId` INTEGER NULL;
CREATE INDEX `Payment_cashCloseId_idx` ON `Payment`(`cashCloseId`);
CREATE INDEX `Payment_paidAt_idx` ON `Payment`(`paidAt`);
