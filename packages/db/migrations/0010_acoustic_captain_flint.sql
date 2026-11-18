CREATE TABLE `outlet_master_audit` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_user_id` text NOT NULL,
	`outlet_id` text NOT NULL,
	`action` text NOT NULL,
	`before` text,
	`after` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`actor_user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "outlet_master_audit_transition" CHECK(("outlet_master_audit"."action" = 'create' and "outlet_master_audit"."before" is null and "outlet_master_audit"."after" is not null) or ("outlet_master_audit"."action" = 'update' and "outlet_master_audit"."before" is not null and "outlet_master_audit"."after" is not null) or ("outlet_master_audit"."action" = 'delete' and "outlet_master_audit"."before" is not null and "outlet_master_audit"."after" is null)),
	CONSTRAINT "outlet_master_audit_json" CHECK(("outlet_master_audit"."before" is null or json_valid("outlet_master_audit"."before")) and ("outlet_master_audit"."after" is null or json_valid("outlet_master_audit"."after")))
);
--> statement-breakpoint
CREATE INDEX `outlet_master_audit_outlet_idx` ON `outlet_master_audit` (`outlet_id`);