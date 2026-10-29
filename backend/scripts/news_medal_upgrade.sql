-- 新闻时间线勋章增量（2026-10 追加）
-- 执行库：zhizhang_map
-- 说明：新闻时间线找齐后发纪念勋章（仅登录用户，幂等）
--       已执行过 news_202610_ddl.sql 旧版的环境执行本文件；新环境直接执行最新版 news_202610_ddl.sql 即可

-- 1) 时间线勋章图标（后台可上传/填写 URL；为空时勋章墙显示默认 🏅）
ALTER TABLE `news_timelines` ADD COLUMN `medal_icon_url` TEXT NULL AFTER `cover_url`;

-- 2) 新闻勋章获得记录（一人一线一枚，幂等）
CREATE TABLE IF NOT EXISTS `news_medal_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `timeline_id` INT NOT NULL,
  `earned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_medal_user_timeline` (`user_id`, `timeline_id`),
  KEY `ix_news_medal_records_user_id` (`user_id`),
  KEY `ix_news_medal_records_timeline_id` (`timeline_id`),
  CONSTRAINT `fk_news_medal_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_news_medal_timeline` FOREIGN KEY (`timeline_id`) REFERENCES `news_timelines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
