CREATE TABLE `telegram_visit_drafts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`submission_key` text NOT NULL,
	`sales_force_id` text NOT NULL,
	`step` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_message` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`visit_id` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`visit_id`) REFERENCES `visits`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "telegram_visit_drafts_step_valid" CHECK("telegram_visit_drafts"."step" in ('outlet','time','notes','followUp','review','submitting','submitted','cancelled','expired')),
	CONSTRAINT "telegram_visit_drafts_payload_json" CHECK(json_valid("telegram_visit_drafts"."payload")),
	CONSTRAINT "telegram_visit_drafts_revision_valid" CHECK(typeof("telegram_visit_drafts"."revision") = 'integer' and "telegram_visit_drafts"."revision" >= 0),
	CONSTRAINT "telegram_visit_drafts_message_valid" CHECK(typeof("telegram_visit_drafts"."last_message") = 'integer' and "telegram_visit_drafts"."last_message" > 0),
	CONSTRAINT "telegram_visit_drafts_expiry_valid" CHECK(typeof("telegram_visit_drafts"."expires_at") = 'integer')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `telegram_visit_drafts_key_unique` ON `telegram_visit_drafts` (`submission_key`);