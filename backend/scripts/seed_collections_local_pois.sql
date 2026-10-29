-- -*- coding: utf-8 -*-
-- =============================================================================
-- 专题模式 · 本地补齐六大古都 POI（仅本地测试用）
-- -----------------------------------------------------------------------------
-- 说明：线上 pois 表已含西安/洛阳/开封/南京/杭州，但本地 map_game 库缺失这 5 个
--       POI，导致 seed_collections_mvp.sql 的「六大古都」专题关联不到点位。
--       本脚本幂等补齐这 5 个 POI（name 存在则跳过）。
-- 依赖：pois 表已存在。
-- =============================================================================

SET NAMES utf8mb4;

INSERT INTO pois
  (name, category, lng, lat, adcode, summary, difficulty, used_count, source, verify_status, shape_type)
SELECT '西安', 'historic_city', 108.940, 34.341, '610100',
       '西安十三朝古都，秦汉唐千年帝都，兵马俑与大雁塔见证盛世',
       2, 0, 'collection', 'approved', 'point'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM pois WHERE name = '西安');

INSERT INTO pois
  (name, category, lng, lat, adcode, summary, difficulty, used_count, source, verify_status, shape_type)
SELECT '洛阳', 'historic_city', 112.454, 34.618, '410300',
       '洛阳十三朝古都，牡丹之城，龙门石窟与白马寺传承河洛文明',
       2, 0, 'collection', 'approved', 'point'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM pois WHERE name = '洛阳');

INSERT INTO pois
  (name, category, lng, lat, adcode, summary, difficulty, used_count, source, verify_status, shape_type)
SELECT '开封', 'historic_city', 114.307, 34.797, '410200',
       '开封七朝古都，北宋东京汴梁，清明上河图里的市井繁华',
       2, 0, 'collection', 'approved', 'point'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM pois WHERE name = '开封');

INSERT INTO pois
  (name, category, lng, lat, adcode, summary, difficulty, used_count, source, verify_status, shape_type)
SELECT '南京', 'historic_city', 118.796, 32.060, '320100',
       '南京六朝古都，十朝都会，秦淮河畔与明城墙诉说兴亡',
       2, 0, 'collection', 'approved', 'point'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM pois WHERE name = '南京');

INSERT INTO pois
  (name, category, lng, lat, adcode, summary, difficulty, used_count, source, verify_status, shape_type)
SELECT '杭州', 'historic_city', 120.155, 30.274, '330100',
       '杭州南宋古都，人间天堂，西湖与灵隐寺浸润江南诗意',
       2, 0, 'collection', 'approved', 'point'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM pois WHERE name = '杭州');
