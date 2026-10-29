-- ============================================================
-- map 项目 数据结构调整 DDL（线上先执行本文件）
-- 生成日期: 2026-08-10（幂等版：所有 DDL 均检测已存在则跳过，可安全重复执行）
-- 说明: 在线上 MySQL 顺序执行；随后执行 theme_pois_online.sql 导入种子
-- ============================================================

-- ===== Part 1: DDL 结构调整（幂等） =====

-- 1.1 pois 表: 新增 source 字段
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pois` ADD COLUMN `source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''种子来源''',
  'SELECT ''skip: pois.source already exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pois' AND COLUMN_NAME = 'source');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.2 pois 表: 新增索引（加速选题查询）
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pois` ADD INDEX `idx_pois_category` (`category`)',
  'SELECT ''skip: idx_pois_category already exists''')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pois' AND INDEX_NAME = 'idx_pois_category');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pois` ADD INDEX `idx_pois_adcode` (`adcode`)',
  'SELECT ''skip: idx_pois_adcode already exists''')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pois' AND INDEX_NAME = 'idx_pois_adcode');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pois` ADD INDEX `idx_pois_difficulty` (`difficulty`)',
  'SELECT ''skip: idx_pois_difficulty already exists''')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pois' AND INDEX_NAME = 'idx_pois_difficulty');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.3 pk_rooms 表: 新增 difficulty 字段
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pk_rooms` ADD COLUMN `difficulty` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT ''hard'' COMMENT ''easy/hard''',
  'SELECT ''skip: pk_rooms.difficulty already exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pk_rooms' AND COLUMN_NAME = 'difficulty');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.4 pk_rooms 表: 新增 category 字段
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pk_rooms` ADD COLUMN `category` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT ''主题分类''',
  'SELECT ''skip: pk_rooms.category already exists''')
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pk_rooms' AND COLUMN_NAME = 'category');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.5 pk_rooms 表: status 索引
SET @sql = (SELECT IF(COUNT(*) = 0,
  'ALTER TABLE `pk_rooms` ADD INDEX `ix_pk_rooms_status` (`status`)',
  'SELECT ''skip: ix_pk_rooms_status already exists''')
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pk_rooms' AND INDEX_NAME = 'ix_pk_rooms_status');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 1.6 封面图说明：OSS covers/ 目录为真实照片，不再清理；
--     缺失封面用 scripts/update_poi_covers.sql 补齐

-- ===== Part 2: poi_themes 主题表 =====

-- 2.1 建表（全新表，与现有表无冲突；code 与 pois.category 逻辑对应，不建外键）
CREATE TABLE IF NOT EXISTS `poi_themes` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(50) NOT NULL COMMENT '主题代码，对应 pois.category',
  `name` VARCHAR(100) NOT NULL COMMENT '主题名称',
  `description` VARCHAR(255) DEFAULT NULL COMMENT '主题简介',
  `icon` VARCHAR(20) DEFAULT NULL COMMENT '主题图标',
  `cover_url` TEXT DEFAULT NULL COMMENT '主题封面图',
  `group_name` VARCHAR(50) DEFAULT NULL COMMENT '主题分组',
  `sort_order` INT NOT NULL DEFAULT 0 COMMENT '排序权重',
  `enabled` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '是否启用',
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_poi_themes_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='POI 主题表';

-- 2.2 主题元数据（幂等：先删后插，8 个主题各配一张封面图）
DELETE FROM `poi_themes` WHERE `code` IN (
  'university_211','scenic_5a','peak_famous','lake_famous',
  'airport_major','historic_city','museum_l1','unesco_whs'
);

INSERT INTO `poi_themes` (`code`,`name`,`description`,`icon`,`cover_url`,`group_name`,`sort_order`,`enabled`) VALUES
('university_211','名校巡礼','寻找全国 115 所 211 工程名校','🎓',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/university_211.jpg',
 '人文历史',1,1),
('historic_city','历史名城','找出国家历史文化名城','🏯',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/historic_city.jpg',
 '人文历史',2,1),
('museum_l1','博物馆之旅','挑战国家一级博物馆','🏛️',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/museum_l1.jpg',
 '人文历史',3,1),
('unesco_whs','世界遗产','探索中国世界遗产地','🌍',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/unesco_whs.jpg',
 '人文历史',4,1),
('scenic_5a','5A 景区','挑战全国 5A 级旅游景区','🏞️',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/scenic_5a.jpg',
 '自然风光',5,1),
('peak_famous','名山挑战','从五岳到极高山，辨认全国名山','⛰️',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/peak_famous.jpg',
 '自然风光',6,1),
('lake_famous','湖泊寻踪','寻找五大淡水湖与高原名湖','🌊',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/lake_famous.jpg',
 '自然风光',7,1),
('airport_major','机场达人','挑战全国主要民用机场','✈️',
 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/airport_major.jpg',
 '城市交通',8,1);

-- ===== Part 3: 主题种子数据 =====
-- 主题种子（751 条，含坐标+封面图）见独立文件: scripts/theme_pois_online.sql
-- 生成方式: python3 -m scripts.export_theme_pois_sql

-- ===== End =====