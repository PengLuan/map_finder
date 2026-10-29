-- 意见留言回复功能（2026-09 第一期：反馈回复 + 我的投稿）
-- 适用于已有 feedback 表的线上库；全新库由 Base.metadata.create_all 自动建表，无需执行。
-- 执行方式：mysql -u <user> -p <dbname> < migrate_feedback_reply.sql

ALTER TABLE `feedback`
  ADD COLUMN `session_id` VARCHAR(64) NULL DEFAULT NULL COMMENT '提交者设备标识' AFTER `ip`,
  ADD COLUMN `admin_reply` TEXT NULL COMMENT '官方回复' AFTER `session_id`,
  ADD COLUMN `replied_at` DATETIME NULL DEFAULT NULL AFTER `admin_reply`,
  ADD COLUMN `replied_by` VARCHAR(50) NULL DEFAULT NULL AFTER `replied_at`,
  ADD INDEX `ix_feedback_session_id` (`session_id`);
