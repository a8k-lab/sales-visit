ALTER TABLE `outlets` ADD `business_id` text;--> statement-breakpoint
ALTER TABLE `outlets` ADD `no_rs` text;--> statement-breakpoint
CREATE UNIQUE INDEX `outlets_business_id_unique` ON `outlets` (`business_id`);