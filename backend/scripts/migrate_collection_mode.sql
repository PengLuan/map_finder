-- -*- coding: utf-8 -*-
-- 地图寻踪 · 专题模式数据库迁移
-- 说明：users 表已存在（PK 模式使用），此处 ALTER 扩展；其余 5 张表为新建。
-- 注意：nickname 列改为 utf8mb4_bin 以实现大小写敏感（哈哈A ≠ 哈哈a）。

-- 0. 扩展现有 users 表：增加邮箱登录字段
ALTER TABLE users
  ADD COLUMN email VARCHAR(128) NULL UNIQUE COMMENT '邮箱（登录凭证，NULL=PK匿名用户）',
  ADD COLUMN total_medals INT NOT NULL DEFAULT 0 COMMENT '勋章总数（冗余字段，便于排行榜）',
  ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN last_login_at DATETIME NULL,
  ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  ADD INDEX idx_total_medals (total_medals);

-- nickname 改为大小写敏感排序规则（utf8mb4_bin），实现"哈哈A"与"哈哈a"为不同用户
ALTER TABLE users
  MODIFY COLUMN nickname VARCHAR(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;

-- 1. collections 专题元数据
CREATE TABLE IF NOT EXISTS collections (
  id           BIGINT PRIMARY KEY AUTO_INCREMENT,
  code         VARCHAR(48)  NOT NULL UNIQUE COMMENT '如 wuyue',
  name         VARCHAR(64)  NOT NULL COMMENT '如 五岳归来',
  description  TEXT         NULL,
  icon         VARCHAR(255) NULL,
  cover_url    TEXT         NULL COMMENT '专题封面图（text_to_image URL 较长，用 TEXT）',
  geometry     VARCHAR(32)  NULL,
  difficulty_star TINYINT  NOT NULL DEFAULT 1 COMMENT '专题难度星级 1-8（1最易，8最难）',
  unlock_require   INT     NOT NULL DEFAULT 0 COMMENT '解锁本星级所需已完成的前一星级专题数',
  audit_status VARCHAR(16) NOT NULL DEFAULT 'pending' COMMENT '审核状态：pending/approved',
  sort_order   INT          DEFAULT 0,
  enabled      TINYINT(1)   DEFAULT 1,
  created_at   DATETIME     NOT NULL,
  INDEX idx_enabled (enabled),
  INDEX idx_star (difficulty_star),
  INDEX idx_audit (audit_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. collection_pois 专题-POI 关联
CREATE TABLE IF NOT EXISTS collection_pois (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL,
  poi_id        BIGINT NOT NULL,
  sort_order    INT    NOT NULL COMMENT '收集顺序（0=起点，1=第2点...）',
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_poi (collection_id, poi_id),
  INDEX idx_collection (collection_id),
  INDEX idx_poi (poi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. medals 勋章表（静态数据：专题×难度×玩法 = 一枚勋章）
CREATE TABLE IF NOT EXISTS medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  collection_id BIGINT NOT NULL,
  difficulty    VARCHAR(10) NOT NULL COMMENT 'easy/hard',
  game_type     VARCHAR(10) NOT NULL COMMENT 'solo/pk',
  name          VARCHAR(64) NOT NULL COMMENT '勋章名（如：五岳归来·困难·单人）',
  icon_url      VARCHAR(255) NULL,
  created_at    DATETIME NOT NULL,
  UNIQUE KEY uk_col_diff_type (collection_id, difficulty, game_type),
  INDEX idx_collection (collection_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. user_medals 用户当前勋章（只保留最快用时）
CREATE TABLE IF NOT EXISTS user_medals (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  medal_id      BIGINT NOT NULL,
  total_time_sec INT NOT NULL COMMENT '当前最快用时',
  earned_at     DATETIME NOT NULL COMMENT '首次获得时间',
  updated_at    DATETIME NOT NULL COMMENT '最近刷新时间',
  UNIQUE KEY uk_user_medal (user_id, medal_id),
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 5. medal_records 勋章记录流水
CREATE TABLE IF NOT EXISTS medal_records (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id       BIGINT NOT NULL,
  medal_id      BIGINT NOT NULL,
  total_time_sec INT NOT NULL COMMENT '本次专题总用时',
  point_times   JSON NULL COMMENT '各点用时数组',
  is_win        TINYINT(1) NOT NULL DEFAULT 1 COMMENT 'PK 模式是否胜利（1胜/0败，solo 恒为1）',
  earned_at     DATETIME NOT NULL,
  INDEX idx_user (user_id),
  INDEX idx_medal (medal_id),
  INDEX idx_earned (earned_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 6. player_sessions 加字段（标记专题对局）
ALTER TABLE player_sessions
  ADD COLUMN collection_id BIGINT NULL COMMENT '关联 collections.id，NULL=非专题',
  ADD COLUMN point_index INT NULL COMMENT '专题第几点，NULL=非专题',
  ADD INDEX idx_collection (collection_id);
