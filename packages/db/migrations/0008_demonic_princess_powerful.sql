CREATE TABLE `sales_force_supervisors` (
	`sales_force_id` text PRIMARY KEY NOT NULL,
	`supervisor_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`supervisor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `sales_force_supervisors_user_idx` ON `sales_force_supervisors` (`supervisor_user_id`);--> statement-breakpoint
CREATE TABLE `supervisor_assignment_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`sales_force_id` text NOT NULL,
	`previous_supervisor_user_id` text,
	`new_supervisor_user_id` text,
	`action` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`sales_force_id`) REFERENCES `sales_force`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`previous_supervisor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	FOREIGN KEY (`new_supervisor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "supervisor_assignment_audit_transition" CHECK(("supervisor_assignment_audit"."action" = 'assign' and "supervisor_assignment_audit"."previous_supervisor_user_id" is null and "supervisor_assignment_audit"."new_supervisor_user_id" is not null) or ("supervisor_assignment_audit"."action" = 'reassign' and "supervisor_assignment_audit"."previous_supervisor_user_id" is not null and "supervisor_assignment_audit"."new_supervisor_user_id" is not null and "supervisor_assignment_audit"."previous_supervisor_user_id" <> "supervisor_assignment_audit"."new_supervisor_user_id") or ("supervisor_assignment_audit"."action" = 'unassign' and "supervisor_assignment_audit"."previous_supervisor_user_id" is not null and "supervisor_assignment_audit"."new_supervisor_user_id" is null))
);
--> statement-breakpoint
CREATE INDEX `supervisor_assignment_audit_sf_idx` ON `supervisor_assignment_audit` (`sales_force_id`);