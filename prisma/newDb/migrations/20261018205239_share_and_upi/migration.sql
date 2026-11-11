-- AlterTable
ALTER TABLE `HotelSetting` ADD COLUMN `upiId` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `Booking` ADD COLUMN `shareToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Booking_shareToken_key` ON `Booking`(`shareToken`);

