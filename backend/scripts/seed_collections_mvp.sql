-- -*- coding: utf-8 -*-
-- =============================================================================
-- 地图寻踪 · 专题模式（收集玩法）MVP 种子数据
-- -----------------------------------------------------------------------------
-- 本脚本向已建好的三张表写入种子数据，仅使用 INSERT/UPDATE 语句：
--   1. collections        —— 5 个专题（五岳归来 / 六大古都 / 四大佛教名山 /
--                              五大淡水湖 / 江南三大名楼）
--   2. collection_pois    —— 每个专题关联若干既有 POI（按 name 子查询引用 pois.id）
--   3. medals             —— 每个专题 4 枚勋章（easy/hard × solo/pk）
--
-- 设计要点：
--   * DB 用户 joy_word 无 SUPER 权限，故不含任何 DDL（ALTER/CREATE/DROP）。
--   * collections.code 唯一，用 INSERT ... ON DUPLICATE KEY UPDATE 幂等刷新。
--   * collection_pois / medals 依赖唯一键，用 INSERT IGNORE / ON DUPLICATE 幂等。
--   * collection_id 通过子查询 WHERE c.code='...' 取得，规避 LAST_INSERT_ID 问题。
--   * poi_id 通过子查询 WHERE p.name='...' 取得；泰山/五台山存在同名多条记录
--     （peak_famous 与 unesco_whs），统一加 ORDER BY p.id LIMIT 1 取 id 最小者
--     （即 peak_famous，专题收集的规范 POI）。
--   * POI 一句话描述写入 pois.summary（pois 表无 description 列，summary 为描述性
--     Text 字段）。
--   * icon / cover_url / geometry 暂置 NULL，几何形状与图标留待后续填充。
--
-- 解锁规则：
--   ★1 专题（lake5 / jiangnan3）unlock_require = 0，默认开放；
--   ★2 专题（wuyue / gudu6 / foshan4）unlock_require = 1，需先完成 1 个 ★1 专题。
--
-- 依赖：migrate_collection_mode.sql 已执行，pois 表已含下列同名 POI。
-- 幂等：可重复执行，不会报错也不会产生重复行。
-- =============================================================================

SET NAMES utf8mb4;

-- =============================================================================
-- 一、写入 5 个专题（collections）
-- =============================================================================
INSERT INTO collections
  (code, name, description, icon, cover_url, geometry,
   difficulty_star, unlock_require, audit_status, sort_order, enabled, created_at)
VALUES
  ('wuyue',    '五岳归来',     '五岳是中国五大名山，历代帝王祭祀之所，集自然与文化之大成',
   NULL, NULL, NULL, 2, 1, 'approved', 1, 1, NOW()),
  ('gudu6',    '六大古都',     '中国历史上的六大古都，承载千年文明兴衰',
   NULL, NULL, NULL, 2, 1, 'approved', 2, 1, NOW()),
  ('foshan4',  '四大佛教名山', '中国佛教四大菩萨道场，智慧与慈悲的圣地',
   NULL, NULL, NULL, 2, 1, 'approved', 3, 1, NOW()),
  ('lake5',    '五大淡水湖',   '中国五大淡水湖，孕育鱼米之乡的江河明珠',
   NULL, NULL, NULL, 1, 0, 'approved', 4, 1, NOW()),
  ('jiangnan3','江南三大名楼', '江南三大名楼，文人墨客千古绝唱之地',
   NULL, NULL, NULL, 1, 0, 'approved', 5, 1, NOW())
ON DUPLICATE KEY UPDATE
  name           = VALUES(name),
  description    = VALUES(description),
  icon           = VALUES(icon),
  cover_url      = VALUES(cover_url),
  geometry       = VALUES(geometry),
  difficulty_star= VALUES(difficulty_star),
  unlock_require = VALUES(unlock_require),
  audit_status   = VALUES(audit_status),
  sort_order     = VALUES(sort_order),
  enabled        = VALUES(enabled);
-- created_at 不在更新列中，保留原始创建时间。


-- =============================================================================
-- 二、写入专题-POI 关联（collection_pois）
--     sort_order 约定：0=起点，1=第2点，2=第3点……（见 migrate 注释）
-- =============================================================================

-- ---- 专题 1：五岳归来（wuyue） 泰山→华山→衡山→嵩山→恒山 ----
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 0, NOW() FROM collections c, pois p
WHERE c.code='wuyue' AND p.name='泰山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 1, NOW() FROM collections c, pois p
WHERE c.code='wuyue' AND p.name='华山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 2, NOW() FROM collections c, pois p
WHERE c.code='wuyue' AND p.name='衡山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 3, NOW() FROM collections c, pois p
WHERE c.code='wuyue' AND p.name='嵩山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 4, NOW() FROM collections c, pois p
WHERE c.code='wuyue' AND p.name='恒山' ORDER BY p.id LIMIT 1;

-- ---- 专题 2：六大古都（gudu6） 北京→西安→洛阳→开封→南京→杭州 ----
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 0, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='北京' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 1, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='西安' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 2, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='洛阳' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 3, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='开封' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 4, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='南京' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 5, NOW() FROM collections c, pois p
WHERE c.code='gudu6' AND p.name='杭州' ORDER BY p.id LIMIT 1;

-- ---- 专题 3：四大佛教名山（foshan4） 五台山→峨眉山→普陀山→九华山 ----
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 0, NOW() FROM collections c, pois p
WHERE c.code='foshan4' AND p.name='五台山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 1, NOW() FROM collections c, pois p
WHERE c.code='foshan4' AND p.name='峨眉山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 2, NOW() FROM collections c, pois p
WHERE c.code='foshan4' AND p.name='普陀山' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 3, NOW() FROM collections c, pois p
WHERE c.code='foshan4' AND p.name='九华山' ORDER BY p.id LIMIT 1;

-- ---- 专题 4：五大淡水湖（lake5） 鄱阳湖→洞庭湖→太湖→洪泽湖→巢湖 ----
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 0, NOW() FROM collections c, pois p
WHERE c.code='lake5' AND p.name='鄱阳湖' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 1, NOW() FROM collections c, pois p
WHERE c.code='lake5' AND p.name='洞庭湖' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 2, NOW() FROM collections c, pois p
WHERE c.code='lake5' AND p.name='太湖' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 3, NOW() FROM collections c, pois p
WHERE c.code='lake5' AND p.name='洪泽湖' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 4, NOW() FROM collections c, pois p
WHERE c.code='lake5' AND p.name='巢湖' ORDER BY p.id LIMIT 1;

-- ---- 专题 5：江南三大名楼（jiangnan3） 黄鹤楼→岳阳楼→滕王阁 ----
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 0, NOW() FROM collections c, pois p
WHERE c.code='jiangnan3' AND p.name='黄鹤楼' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 1, NOW() FROM collections c, pois p
WHERE c.code='jiangnan3' AND p.name='岳阳楼' ORDER BY p.id LIMIT 1;
INSERT IGNORE INTO collection_pois (collection_id, poi_id, sort_order, created_at)
SELECT c.id, p.id, 2, NOW() FROM collections c, pois p
WHERE c.code='jiangnan3' AND p.name='滕王阁' ORDER BY p.id LIMIT 1;


-- =============================================================================
-- 三、写入勋章（medals）每个专题 4 枚：easy/hard × solo/pk
--     name 格式：{专题名}·{难度}·{玩法}，难度 easy=简单/hard=困难，玩法 solo=单人/pk=对战
--     唯一键 uk_col_diff_type (collection_id, difficulty, game_type) 保证幂等。
-- =============================================================================

-- ---- 专题 1：五岳归来 ----
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'solo', '五岳归来·简单·单人', NULL, NOW() FROM collections c WHERE c.code='wuyue'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'solo', '五岳归来·困难·单人', NULL, NOW() FROM collections c WHERE c.code='wuyue'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'pk', '五岳归来·简单·对战', NULL, NOW() FROM collections c WHERE c.code='wuyue'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'pk', '五岳归来·困难·对战', NULL, NOW() FROM collections c WHERE c.code='wuyue'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);

-- ---- 专题 2：六大古都 ----
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'solo', '六大古都·简单·单人', NULL, NOW() FROM collections c WHERE c.code='gudu6'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'solo', '六大古都·困难·单人', NULL, NOW() FROM collections c WHERE c.code='gudu6'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'pk', '六大古都·简单·对战', NULL, NOW() FROM collections c WHERE c.code='gudu6'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'pk', '六大古都·困难·对战', NULL, NOW() FROM collections c WHERE c.code='gudu6'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);

-- ---- 专题 3：四大佛教名山 ----
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'solo', '四大佛教名山·简单·单人', NULL, NOW() FROM collections c WHERE c.code='foshan4'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'solo', '四大佛教名山·困难·单人', NULL, NOW() FROM collections c WHERE c.code='foshan4'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'pk', '四大佛教名山·简单·对战', NULL, NOW() FROM collections c WHERE c.code='foshan4'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'pk', '四大佛教名山·困难·对战', NULL, NOW() FROM collections c WHERE c.code='foshan4'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);

-- ---- 专题 4：五大淡水湖 ----
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'solo', '五大淡水湖·简单·单人', NULL, NOW() FROM collections c WHERE c.code='lake5'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'solo', '五大淡水湖·困难·单人', NULL, NOW() FROM collections c WHERE c.code='lake5'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'pk', '五大淡水湖·简单·对战', NULL, NOW() FROM collections c WHERE c.code='lake5'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'pk', '五大淡水湖·困难·对战', NULL, NOW() FROM collections c WHERE c.code='lake5'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);

-- ---- 专题 5：江南三大名楼 ----
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'solo', '江南三大名楼·简单·单人', NULL, NOW() FROM collections c WHERE c.code='jiangnan3'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'solo', '江南三大名楼·困难·单人', NULL, NOW() FROM collections c WHERE c.code='jiangnan3'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'easy', 'pk', '江南三大名楼·简单·对战', NULL, NOW() FROM collections c WHERE c.code='jiangnan3'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);
INSERT INTO medals (collection_id, difficulty, game_type, name, icon_url, created_at)
SELECT c.id, 'hard', 'pk', '江南三大名楼·困难·对战', NULL, NOW() FROM collections c WHERE c.code='jiangnan3'
ON DUPLICATE KEY UPDATE name=VALUES(name), icon_url=VALUES(icon_url);


-- =============================================================================
-- 四、回填 POI 一句话描述（pois.summary）
--     pois 表无 description 列，summary 为描述性 Text 字段，承载一句话简介。
--     UPDATE 同名多 POI（如泰山含 peak_famous 与 unesco_whs 两条）一并更新，无副作用。
-- =============================================================================

-- 五岳
UPDATE pois SET summary = '泰山海拔1545m，五岳之首，历代帝王封禅之地，世界文化与自然双遗产' WHERE name = '泰山';
UPDATE pois SET summary = '华山海拔2154m，五岳之西岳，以险峻著称，自古华山一条路' WHERE name = '华山';
UPDATE pois SET summary = '衡山海拔1300m，五岳之南岳，祀奉火神祝融，自古寿岳之称' WHERE name = '衡山';
UPDATE pois SET summary = '嵩山海拔1491m，五岳之中岳，少林禅宗祖庭，天地之中' WHERE name = '嵩山';
UPDATE pois SET summary = '恒山海拔2016m，五岳之北岳，道教全真派圣地，悬空寺奇观' WHERE name = '恒山';

-- 六大古都
UPDATE pois SET summary = '北京三千年建城史，元明清三代帝都，故宫长城承载皇家气韵' WHERE name = '北京';
UPDATE pois SET summary = '西安十三朝古都，秦汉唐千年帝都，兵马俑与大雁塔见证盛世' WHERE name = '西安';
UPDATE pois SET summary = '洛阳十三朝古都，牡丹之城，龙门石窟与白马寺传承河洛文明' WHERE name = '洛阳';
UPDATE pois SET summary = '开封七朝古都，北宋东京汴梁，清明上河图里的市井繁华' WHERE name = '开封';
UPDATE pois SET summary = '南京六朝古都，十朝都会，秦淮河畔与明城墙诉说兴亡' WHERE name = '南京';
UPDATE pois SET summary = '杭州南宋古都，人间天堂，西湖与灵隐寺浸润江南诗意' WHERE name = '杭州';

-- 四大佛教名山
UPDATE pois SET summary = '五台山海拔3061m，文殊菩萨道场，青庙黄庙并立，华北屋脊' WHERE name = '五台山';
UPDATE pois SET summary = '峨眉山海拔3099m，普贤菩萨道场，云海日出金顶，佛国仙山' WHERE name = '峨眉山';
UPDATE pois SET summary = '普陀山海拔291m，观音菩萨道场，海天佛国，南海观音普济' WHERE name = '普陀山';
UPDATE pois SET summary = '九华山海拔1344m，地藏菩萨道场，莲花佛国，肉身宝殿梵音' WHERE name = '九华山';

-- 五大淡水湖
UPDATE pois SET summary = '鄱阳湖中国第一大淡水湖，江西之肾，候鸟越冬天堂' WHERE name = '鄱阳湖';
UPDATE pois SET summary = '洞庭湖古称云梦泽，长江中游调蓄之肺，八百里洞庭' WHERE name = '洞庭湖';
UPDATE pois SET summary = '太湖中国第三大淡水湖，江南鱼米之乡，三万六千顷烟波' WHERE name = '太湖';
UPDATE pois SET summary = '洪泽湖中国第四大淡水湖，悬湖奇观，淮河入江枢纽' WHERE name = '洪泽湖';
UPDATE pois SET summary = '巢湖中国第五大淡水湖，皖中明珠，三面环山鱼米丰' WHERE name = '巢湖';

-- 江南三大名楼
UPDATE pois SET summary = '黄鹤楼江南三大名楼之首，崔颢题诗李白搁笔，武昌江山胜景' WHERE name = '黄鹤楼';
UPDATE pois SET summary = '岳阳楼江南三大名楼，范仲淹岳阳楼记，先忧后乐传千古' WHERE name = '岳阳楼';
UPDATE pois SET summary = '滕王阁江南三大名楼，王勃作序，落霞与孤鹜齐飞千古传唱' WHERE name = '滕王阁';

-- =============================================================================
-- 完成。执行后可通过下列语句核对：
--   SELECT code, name, difficulty_star, unlock_require, enabled FROM collections ORDER BY sort_order;
--   SELECT c.code, p.name, cp.sort_order FROM collection_pois cp
--     JOIN collections c ON cp.collection_id=c.id JOIN pois p ON cp.poi_id=p.id ORDER BY c.code, cp.sort_order;
--   SELECT c.code, m.difficulty, m.game_type, m.name FROM medals m
--     JOIN collections c ON m.collection_id=c.id ORDER BY c.code, m.difficulty, m.game_type;
-- =============================================================================
