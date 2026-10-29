-- 给 player_sessions 表新增 ip_region 字段（IP 归属地，省市区文本）
-- 执行：mysql -u <user> -p <db> < scripts/migrate_ip_region.sql
-- 或在宝塔/Navicat 直接执行

ALTER TABLE player_sessions
  ADD COLUMN ip_region VARCHAR(128) NULL COMMENT 'IP归属地（高德IP定位查询，省市区文本）' AFTER ip;
