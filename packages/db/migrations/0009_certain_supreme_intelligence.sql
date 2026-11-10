CREATE TABLE `sales_force_master_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`sales_force_id` text NOT NULL,
	`action` text NOT NULL,
	`previous_name` text,
	`new_name` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "sales_force_master_audit_transition" CHECK(("sales_force_master_audit"."action" = 'create' and "sales_force_master_audit"."previous_name" is null and "sales_force_master_audit"."new_name" is not null) or ("sales_force_master_audit"."action" = 'rename' and "sales_force_master_audit"."previous_name" is not null and "sales_force_master_audit"."new_name" is not null and "sales_force_master_audit"."previous_name" <> "sales_force_master_audit"."new_name") or ("sales_force_master_audit"."action" = 'delete' and "sales_force_master_audit"."previous_name" is not null and "sales_force_master_audit"."new_name" is null))
);
--> statement-breakpoint
CREATE INDEX `sales_force_master_audit_sf_idx` ON `sales_force_master_audit` (`sales_force_id`);