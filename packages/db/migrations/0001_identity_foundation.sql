CREATE TABLE `telegram_identities` (
	`user_id` text PRIMARY KEY NOT NULL,
	`telegram_user_id` text NOT NULL,
	`username` text,
	`first_name` text,
	`last_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "telegram_identities_id_canonical" CHECK(typeof("telegram_identities"."telegram_user_id") = 'text' and "telegram_identities"."telegram_user_id" glob '[1-9]*' and "telegram_identities"."telegram_user_id" not glob '*[^0-9]*' and instr("telegram_identities"."telegram_user_id", char(0)) = 0),
	CONSTRAINT "telegram_identities_timestamps_integer" CHECK(typeof("telegram_identities"."created_at") = 'integer' and typeof("telegram_identities"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_identities_telegram_user_unique` ON `telegram_identities` (`telegram_user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`role` text,
	`sales_force_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "users_id_nonblank" CHECK(length(trim("users"."id")) > 0),
	CONSTRAINT "users_status_valid" CHECK("users"."status" in ('pending', 'active', 'rejected', 'disabled')),
	CONSTRAINT "users_role_valid" CHECK("users"."role" is null or "users"."role" in ('admin', 'supervisor', 'sales_force')),
	CONSTRAINT "users_approved_role_required" CHECK("users"."status" not in ('active', 'disabled') or "users"."role" is not null),
	CONSTRAINT "users_timestamps_integer" CHECK(typeof("users"."created_at") = 'integer' and typeof("users"."updated_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `users_sales_force_idx` ON `users` (`sales_force_id`);