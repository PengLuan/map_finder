-- 后台管理 & UGC & 区域范围判定 迁移脚本
-- 适用于已有 pois 表的线上库；全新库由 Base.metadata.create_all 自动建表，无需执行。
-- 执行：mysql -u <user> -p map_game < scripts/migrate_admin.sql

-- 1. pois 表扩展字段
ALTER TABLE pois
  ADD COLUMN verify_status VARCHAR(20) DEFAULT 'approved' COMMENT 'approved/pending/rejected',
  ADD COLUMN submitted_by VARCHAR(64) NULL COMMENT '提交者 session_id',
  ADD COLUMN contributor_nickname VARCHAR(32) NULL COMMENT '贡献者署名',
  ADD COLUMN shape_type VARCHAR(10) DEFAULT 'point' COMMENT 'point/circle/polygon',
  ADD COLUMN radius_km DOUBLE DEFAULT 0 COMMENT 'circle 半径(km)',
  ADD COLUMN area_geojson TEXT NULL COMMENT 'polygon 的 GeoJSON';

ALTER TABLE pois ADD INDEX idx_shape (shape_type);

-- 2. 玩家会话表
CREATE TABLE IF NOT EXISTS player_sessions (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id  VARCHAR(64)  NOT NULL,
  ip          VARCHAR(45)  NOT NULL,
  nickname    VARCHAR(32)  NULL,
  ua          VARCHAR(256) NULL,
  mode        VARCHAR(20)  NOT NULL,
  region_code VARCHAR(12)  NULL,
  category    VARCHAR(32)  NULL,
  difficulty  VARCHAR(10)  NOT NULL,
  game_type   VARCHAR(10)  NOT NULL,
  target_poi_id BIGINT     NULL,
  won         TINYINT(1)   DEFAULT 0,
  score       INT          DEFAULT 0,
  duration_sec INT         DEFAULT 0,
  started_at  DATETIME     NOT NULL,
  ended_at    DATETIME     NULL,
  INDEX idx_session_sid (session_id),
  INDEX idx_session_ip (ip),
  INDEX idx_session_started (started_at)
);

-- 3. UGC 投稿表
CREATE TABLE IF NOT EXISTS poi_submissions (
  id            BIGINT PRIMARY KEY AUTO_INCREMENT,
  session_id    VARCHAR(64)  NOT NULL,
  nickname      VARCHAR(32)  NULL,
  name          VARCHAR(128) NOT NULL,
  province_code VARCHAR(12)  NULL,
  category      VARCHAR(32)  NULL,
  lng           DOUBLE       NOT NULL,
  lat           DOUBLE       NOT NULL,
  description   TEXT         NULL,
  cover_url     VARCHAR(512) NULL,
  suggested_shape_type VARCHAR(10) DEFAULT 'point',
  suggested_radius_km  DOUBLE DEFAULT 0,
  suggested_area_geojson TEXT NULL,
  status        VARCHAR(20)  DEFAULT 'pending',
  reviewer_note VARCHAR(256) NULL,
  submitted_at  DATETIME     NOT NULL,
  reviewed_at   DATETIME     NULL,
  INDEX idx_sub_status (status),
  INDEX idx_sub_submitted (submitted_at)
);
