-- Extend the audit action CHECK without changing existing history.
-- No table references access_audit; foreign-key enforcement stays enabled.
CREATE TABLE `__new_access_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`target_user_id` text NOT NULL,
	`action` text NOT NULL,
	`before_state` text NOT NULL,
	`after_state` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`target_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "access_audit_action_valid" CHECK("__new_access_audit"."action" in ('register', 'approve', 'reject', 'setrole', 'disable', 'enable')),
	CONSTRAINT "access_audit_states_json" CHECK(json_valid("__new_access_audit"."before_state") and json_valid("__new_access_audit"."after_state")),
	CONSTRAINT "access_audit_time_integer" CHECK(typeof("__new_access_audit"."created_at") = 'integer')
);
--> statement-breakpoint
INSERT INTO `__new_access_audit`("id", "actor_user_id", "target_user_id", "action", "before_state", "after_state", "created_at") SELECT "id", "actor_user_id", "target_user_id", "action", "before_state", "after_state", "created_at" FROM `access_audit`;--> statement-breakpoint
DROP TABLE `access_audit`;--> statement-breakpoint
ALTER TABLE `__new_access_audit` RENAME TO `access_audit`;--> statement-breakpoint
CREATE INDEX `access_audit_target_idx` ON `access_audit` (`target_user_id`);