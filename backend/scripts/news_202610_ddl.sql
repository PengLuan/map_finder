-- 「小寻带你看新闻」功能 DDL（2026-10 批次）
-- 执行库：zhizhang_map
-- 说明：新闻时间线独立于勋章/专题体系，不复用 pois 表
-- 注意：需等待 DDL 执行完成后再重启后端（create_all 与迁移冲突惯例）

CREATE TABLE IF NOT EXISTS `news_timelines` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(48) NOT NULL,
  `name` VARCHAR(64) NOT NULL,
  `description` TEXT NULL,
  `color` VARCHAR(16) NULL,
  `cover_url` TEXT NULL,
  `medal_icon_url` TEXT NULL,
  `batch` VARCHAR(16) NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `audit_status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_timelines_code` (`code`),
  KEY `ix_news_timelines_batch` (`batch`),
  KEY `ix_news_timelines_audit_status` (`audit_status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `news_pois` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `timeline_id` INT NOT NULL,
  `name` VARCHAR(200) NOT NULL,
  `event_date` VARCHAR(16) NULL,
  `event_text` TEXT NULL,
  `fact_text` TEXT NULL,
  `hint_text` TEXT NULL,
  `link_url` TEXT NULL,
  `link_source` VARCHAR(64) NULL,
  `link_checked_at` DATETIME NULL,
  `lng` DOUBLE NOT NULL,
  `lat` DOUBLE NOT NULL,
  `region` VARCHAR(100) NULL,
  `difficulty` SMALLINT NOT NULL DEFAULT 3,
  `cover_url` TEXT NULL,
  `sort_order` INT NOT NULL DEFAULT 0,
  `verified` TINYINT(1) NOT NULL DEFAULT 0,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_pois_timeline_sort` (`timeline_id`, `sort_order`),
  KEY `ix_news_pois_timeline_id` (`timeline_id`),
  KEY `ix_news_pois_status` (`status`),
  KEY `ix_news_pois_verified` (`verified`),
  CONSTRAINT `fk_news_pois_timeline` FOREIGN KEY (`timeline_id`) REFERENCES `news_timelines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `news_progress` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(64) NOT NULL,
  `mode` VARCHAR(8) NOT NULL DEFAULT 'easy',
  `user_id` INT NULL,
  `timeline_id` INT NOT NULL,
  `poi_id` INT NOT NULL,
  `found_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `found_lng` DOUBLE NULL,
  `found_lat` DOUBLE NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_progress_session_mode_poi` (`session_id`, `mode`, `poi_id`),
  KEY `ix_news_progress_timeline_id` (`timeline_id`),
  KEY `ix_news_progress_user_id` (`user_id`),
  CONSTRAINT `fk_news_progress_timeline` FOREIGN KEY (`timeline_id`) REFERENCES `news_timelines` (`id`),
  CONSTRAINT `fk_news_progress_poi` FOREIGN KEY (`poi_id`) REFERENCES `news_pois` (`id`),
  CONSTRAINT `fk_news_progress_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 新闻勋章获得记录（找齐发勋章，一人一线一模式一枚；旧环境增量见 news_medal_upgrade.sql / news_mode_upgrade.sql）
CREATE TABLE IF NOT EXISTS `news_medal_records` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `timeline_id` INT NOT NULL,
  `mode` VARCHAR(8) NOT NULL DEFAULT 'easy',
  `earned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_news_medal_user_timeline_mode` (`user_id`, `timeline_id`, `mode`),
  KEY `ix_news_medal_records_user_id` (`user_id`),
  KEY `ix_news_medal_records_timeline_id` (`timeline_id`),
  CONSTRAINT `fk_news_medal_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_news_medal_timeline` FOREIGN KEY (`timeline_id`) REFERENCES `news_timelines` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 新闻事件纠错反馈（玩家提交，后台处理；旧环境增量见 news_corrections_upgrade.sql）
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
