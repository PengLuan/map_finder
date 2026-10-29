-- 第四期：排行榜用户主页（2026-09）
-- users 表加 slogan + profile_public；执行库：zhizhang_map

ALTER TABLE `users`
  ADD COLUMN `slogan` VARCHAR(100) NULL AFTER `avatar_url`,
  ADD COLUMN `profile_public` TINYINT(1) NOT NULL DEFAULT 1 AFTER `slogan`;
