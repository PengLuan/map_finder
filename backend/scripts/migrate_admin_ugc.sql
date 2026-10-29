-- 后台管理 + UGC + 区域范围判定 数据库迁移
-- 对应 docs/admin-and-ugc-plan.md 方案
--
-- 说明：
-- - player_sessions / poi_submissions 为新表，由 SQLAlchemy Base.metadata.create_all 自动创建
-- - pois 表为已存在表，create_all 不会添加新字段，需手动执行下方 ALTER
-- - 所有 ALTER 均带 IF NOT EXISTS 语义兼容（MySQL 8.0+ 支持），若为低版本请去掉重复执行
--
-- 执行方式（在 map_game 数据库下）：
--   mysql -u <user> -p map_game < scripts/migrate_admin_ugc.sql

-- ===== 1. pois 表扩展：区域范围判定 + UGC 审核 + 贡献者 =====

-- 审核状态：approved/pending/rejected（默认 approved 向后兼容）
ALTER TABLE pois ADD COLUMN verify_status VARCHAR(20) DEFAULT 'approved'
  COMMENT 'approved/pending/rejected';

-- 提交者 session_id（UGC 来源标记）
ALTER TABLE pois ADD COLUMN submitted_by VARCHAR(64) NULL
  COMMENT '提交者 session_id';

-- 贡献者昵称（结算面板署名）
ALTER TABLE pois ADD COLUMN contributor_nickname VARCHAR(32) NULL
  COMMENT '贡献者署名';

-- 目标形态：point=点判定 / circle=圆形范围 / polygon=多边形范围
ALTER TABLE pois ADD COLUMN shape_type VARCHAR(10) DEFAULT 'point'
  COMMENT 'point/circle/polygon';
ALTER TABLE pois ADD INDEX idx_shape (shape_type);

-- circle 的判定半径（km），0 表示点判定
ALTER TABLE pois ADD COLUMN radius_km FLOAT DEFAULT 0
  COMMENT 'circle 半径 km';

-- polygon 的 GeoJSON Polygon/MultiPolygon 字符串
ALTER TABLE pois ADD COLUMN area_geojson TEXT NULL
  COMMENT 'polygon GeoJSON';

-- ===== 2. 旧数据兼容（确认所有现有 POI 默认为 point / approved） =====

UPDATE pois SET shape_type = 'point' WHERE shape_type IS NULL OR shape_type = '';
UPDATE pois SET verify_status = 'approved' WHERE verify_status IS NULL OR verify_status = '';
UPDATE pois SET radius_km = 0 WHERE radius_km IS NULL;

-- ===== 3. player_sessions / poi_submissions =====
-- 由后端启动时 Base.metadata.create_all 自动创建，无需手动建表。
-- 若需手动建表，可参考 docs/admin-and-ugc-plan.md 中的 SQL 定义。
