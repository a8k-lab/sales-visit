CREATE TABLE `telegram_demo_choices` (
  `token` text PRIMARY KEY NOT NULL,
  `telegram_user_id` text NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `telegram_demo_choices_owner` ON `telegram_demo_choices` (`telegram_user_id`);
--> statement-breakpoint
CREATE INDEX `telegram_demo_choices_expiry` ON `telegram_demo_choices` (`expires_at`);
--> statement-breakpoint
CREATE TABLE `telegram_demo_sessions` (
  `telegram_user_id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL REFERENCES `users`(`id`) ON DELETE cascade,
  `created_at` integer NOT NULL,
  `expires_at` integer NOT NULL,
  CONSTRAINT `telegram_demo_session_duration` CHECK (`expires_at` = `created_at` + 3600000)
);
--> statement-breakpoint
-- Deliberately additive: avoid Drizzle's table rebuild for added CHECKs.
-- Existing operational rows default to non-demo; no identity or report changes.
ALTER TABLE `outlets` ADD COLUMN `demo_only` integer DEFAULT 0 NOT NULL CONSTRAINT `outlets_demo_only` CHECK (`demo_only` IN (0,1));
--> statement-breakpoint
ALTER TABLE `sales_force` ADD COLUMN `demo_only` integer DEFAULT 0 NOT NULL CONSTRAINT `sales_force_demo_only` CHECK (`demo_only` IN (0,1));
--> statement-breakpoint
ALTER TABLE `visit_schedules` ADD COLUMN `demo_only` integer DEFAULT 0 NOT NULL CONSTRAINT `visit_schedules_demo_only` CHECK (`demo_only` IN (0,1));
