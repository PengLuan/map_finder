-- 第三期：开发计划公示 + 用户评价（2026-09）
-- 仅包含 INSERT 之外的 DDL；执行库：zhizhang_map

CREATE TABLE IF NOT EXISTS `dev_plans` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `title` VARCHAR(128) NOT NULL,
  `content` TEXT NOT NULL,
  `status` VARCHAR(20) NOT NULL DEFAULT 'planning',
  `sort_order` INT NOT NULL DEFAULT 0,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_dev_plans_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `dev_plan_feedbacks` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `plan_id` INT NOT NULL,
  `session_id` VARCHAR(64) NOT NULL,
  `nickname` VARCHAR(50) NULL,
  `attitude` VARCHAR(10) NOT NULL,
  `comment` VARCHAR(256) NULL,
  `images` TEXT NULL,
  `withdrawn_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_dev_plan_feedback` (`plan_id`, `session_id`),
  KEY `ix_dev_plan_feedbacks_plan_id` (`plan_id`),
  KEY `ix_dev_plan_feedbacks_session_id` (`session_id`),
  KEY `ix_dev_plan_feedbacks_created_at` (`created_at`),
  CONSTRAINT `fk_dev_plan_feedbacks_plan` FOREIGN KEY (`plan_id`) REFERENCES `dev_plans` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 增量：旧版本已建表时补 withdrawn_at 列（幂等需手动判断，MySQL 8 可用 IF NOT EXISTS）
-- ALTER TABLE `dev_plan_feedbacks` ADD COLUMN `withdrawn_at` DATETIME NULL AFTER `images`;
