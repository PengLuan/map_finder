-- 新闻纠错反馈表增量（2026-10 追加）
-- 执行库：zhizhang_map；新环境直接执行最新版 news_202610_ddl.sql 即可

CREATE TABLE IF NOT EXISTS `news_corrections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `news_poi_id` INT NOT NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `nickname` VARCHAR(50) NULL,
  `content` TEXT NOT NULL,
  `contact` VARCHAR(100) NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `reviewer_note` VARCHAR(256) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_news_corrections_poi` (`news_poi_id`),
  KEY `ix_news_corrections_status` (`status`),
  KEY `ix_news_corrections_session` (`session_id`),
  CONSTRAINT `fk_news_corrections_poi` FOREIGN KEY (`news_poi_id`) REFERENCES `news_pois` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
