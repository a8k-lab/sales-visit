CREATE TABLE `access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "access_audit_action_valid" CHECK("access_audit"."action" in ('register', 'approve', 'reject')),
	CONSTRAINT "access_audit_states_json" CHECK(json_valid("access_audit"."before_state") and json_valid("access_audit"."after_state")),
	CONSTRAINT "access_audit_time_integer" CHECK(typeof("access_audit"."created_at") = 'integer')
);
--> statement-breakpoint
CREATE INDEX `access_audit_target_idx` ON `access_audit` (`target_user_id`);