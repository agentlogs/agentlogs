-- Migration: Add blob storage tables for transcript images/screenshots
-- These tables enable content-addressed storage with deduplication

CREATE TABLE `blobs` (
	`sha256` text PRIMARY KEY NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer NOT NULL
);

CREATE TABLE `transcript_blobs` (
	`id` text PRIMARY KEY NOT NULL,
	`transcript_id` text NOT NULL,
	`sha256` text NOT NULL,
	FOREIGN KEY (`transcript_id`) REFERENCES `transcripts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sha256`) REFERENCES `blobs`(`sha256`) ON UPDATE no action ON DELETE cascade
);

CREATE UNIQUE INDEX `idx_transcript_blob_unique` ON `transcript_blobs` (`transcript_id`,`sha256`);
CREATE INDEX `idx_transcript_blobs_sha256` ON `transcript_blobs` (`sha256`);
