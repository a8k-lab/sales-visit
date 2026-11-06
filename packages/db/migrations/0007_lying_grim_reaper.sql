CREATE TABLE `web_login_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`nonce` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`consumed_at` integer,
	CONSTRAINT "web_challenge_expiry" CHECK("web_login_challenges"."expires_at" > "web_login_challenges"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `web_login_challenges_nonce_unique` ON `web_login_challenges` (`nonce`);--> statement-breakpoint
CREATE INDEX `web_challenge_expiry_idx` ON `web_login_challenges` (`expires_at`);--> statement-breakpoint
CREATE TABLE `web_sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE restrict ON DELETE restrict,
	CONSTRAINT "web_session_hash" CHECK(length("web_sessions"."token_hash") = 64 and "web_sessions"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "web_session_expiry" CHECK("web_sessions"."expires_at" > "web_sessions"."created_at")
);
--> statement-breakpoint
CREATE INDEX `web_session_user_idx` ON `web_sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `web_session_expiry_idx` ON `web_sessions` (`expires_at`);