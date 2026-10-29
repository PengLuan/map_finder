-- 提示系统重构：积分（机会）机制 + 设备类型 + bbox 反查 + 救济计数
-- 对应 docs/hint-system-and-shape-display-plan.md 方案 3.5 / 3.4 / 3.2
--
-- 说明：
-- - 所有 ALTER 均为纯 DDL，不含存储过程/事件（数据库用户无 SUPER 权限）
-- - 风格参考 migrate_admin_ugc.sql，重复执行若列已存在会报错，忽略该错误即可
-- - 新字段均有 DEFAULT，向后兼容现有数据
--
-- 执行方式（在 map_game 数据库下）：
--   mysql -u <user> -p map_game < scripts/migrate_hint_credits.sql

-- ===== 1. game_records 表扩展：设备 + 积分 + 救济计数 + 上次视野 =====

-- 设备类型：pc / mobile（双端差异化判定依据，后端按此返回不同阈值与文案）
ALTER TABLE game_records ADD COLUMN device VARCHAR(10) NOT NULL DEFAULT 'pc'
  COMMENT 'pc/mobile 设备类型';

-- 剩余积分（机会）：开局 100，主动提示消耗，归零后主动提示 403
ALTER TABLE game_records ADD COLUMN hint_credits INT NOT NULL DEFAULT 100
  COMMENT '剩余提示积分（机会）';

-- 简单模式方向提示次数（level 2/4 合并计配额，PC 3/移动 10）
ALTER TABLE game_records ADD COLUMN easy_dir_hint_count INT NOT NULL DEFAULT 0
  COMMENT '简单模式方向提示已用次数';

-- 困难 A 救济次数（PC 1/移动 2）
ALTER TABLE game_records ADD COLUMN bearing_hint_count INT NOT NULL DEFAULT 0
  COMMENT '困难 A 方位救济已用次数';

-- 困难 A 救济：上次视野中心（计算屏幕中心变化方向）
ALTER TABLE game_records ADD COLUMN prev_view_lng DOUBLE NULL
  COMMENT '上次视野中心经度（A救济用）';
ALTER TABLE game_records ADD COLUMN prev_view_lat DOUBLE NULL
  COMMENT '上次视野中心纬度（A救济用）';

-- ===== 2. regions 表扩展：bbox 反查（玩家当前位置→省/市）=====

ALTER TABLE regions ADD COLUMN bbox_w DOUBLE NULL COMMENT 'bbox 西边界';
ALTER TABLE regions ADD COLUMN bbox_s DOUBLE NULL COMMENT 'bbox 南边界';
ALTER TABLE regions ADD COLUMN bbox_e DOUBLE NULL COMMENT 'bbox 东边界';
ALTER TABLE regions ADD COLUMN bbox_n DOUBLE NULL COMMENT 'bbox 北边界';

-- ===== 3. pk_games 表扩展：双方独立积分 + 设备 + 救济计数 + 上次视野 =====

ALTER TABLE pk_games ADD COLUMN player1_hint_credits INT NOT NULL DEFAULT 100
  COMMENT '玩家1剩余提示积分';
ALTER TABLE pk_games ADD COLUMN player2_hint_credits INT NOT NULL DEFAULT 100
  COMMENT '玩家2剩余提示积分';

ALTER TABLE pk_games ADD COLUMN player1_device VARCHAR(10) NOT NULL DEFAULT 'pc'
  COMMENT '玩家1设备类型';
ALTER TABLE pk_games ADD COLUMN player2_device VARCHAR(10) NOT NULL DEFAULT 'pc'
  COMMENT '玩家2设备类型';

ALTER TABLE pk_games ADD COLUMN player1_easy_dir_hint_count INT NOT NULL DEFAULT 0
  COMMENT '玩家1简单方向提示已用次数';
ALTER TABLE pk_games ADD COLUMN player2_easy_dir_hint_count INT NOT NULL DEFAULT 0
  COMMENT '玩家2简单方向提示已用次数';

ALTER TABLE pk_games ADD COLUMN player1_bearing_hint_count INT NOT NULL DEFAULT 0
  COMMENT '玩家1困难A方位救济已用次数';
ALTER TABLE pk_games ADD COLUMN player2_bearing_hint_count INT NOT NULL DEFAULT 0
  COMMENT '玩家2困难A方位救济已用次数';

ALTER TABLE pk_games ADD COLUMN player1_prev_view_lng DOUBLE NULL
  COMMENT '玩家1上次视野中心经度';
ALTER TABLE pk_games ADD COLUMN player1_prev_view_lat DOUBLE NULL
  COMMENT '玩家1上次视野中心纬度';
ALTER TABLE pk_games ADD COLUMN player2_prev_view_lng DOUBLE NULL
  COMMENT '玩家2上次视野中心经度';
ALTER TABLE pk_games ADD COLUMN player2_prev_view_lat DOUBLE NULL
  COMMENT '玩家2上次视野中心纬度';
