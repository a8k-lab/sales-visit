CREATE TABLE `visit_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`sales_force_id` text NOT NULL,
	`outlet_id` text NOT NULL,
	`weekday` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`outlet_id`) REFERENCES `outlets`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "visit_schedules_id_nonblank" CHECK(length(trim("visit_schedules"."id")) > 0),
	CONSTRAINT "visit_schedules_weekday_valid" CHECK(typeof("visit_schedules"."weekday") = 'integer' and "visit_schedules"."weekday" between 1 and 7),
	CONSTRAINT "visit_schedules_timestamps_integer" CHECK(typeof("visit_schedules"."created_at") = 'integer' and typeof("visit_schedules"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `visit_schedules_outlet_idx` ON `visit_schedules` (`outlet_id`);--> statement-breakpoint
CREATE INDEX `visit_schedules_weekday_idx` ON `visit_schedules` (`weekday`);--> statement-breakpoint
CREATE UNIQUE INDEX `visit_schedules_assignment_unique` ON `visit_schedules` (`sales_force_id`,`outlet_id`,`weekday`);--> statement-breakpoint
ALTER TABLE `outlets` ADD `updated_at` integer;