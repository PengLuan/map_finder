-- 新闻找点进度/勋章按模式（点选 easy / 巡航 hard）独立增量
-- 执行库：zhizhang_map
-- 说明：对齐专题模式模型——两种玩法进度独立、各发一枚勋章；旧进度数据归入 easy（本地测试数据可清）

-- 1) 找点进度加 mode，唯一键改为 (session_id, mode, poi_id)
ALTER TABLE `news_progress` ADD COLUMN `mode` VARCHAR(8) NOT NULL DEFAULT 'easy' AFTER `session_id`;
ALTER TABLE `news_progress` DROP INDEX `uk_news_progress_session_poi`;
ALTER TABLE `news_progress`
  ADD UNIQUE KEY `uk_news_progress_session_mode_poi` (`session_id`, `mode`, `poi_id`);

-- 2) 勋章记录加 mode，唯一键改为 (user_id, timeline_id, mode)
ALTER TABLE `news_medal_records` ADD COLUMN `mode` VARCHAR(8) NOT NULL DEFAULT 'easy' AFTER `timeline_id`;
ALTER TABLE `news_medal_records` DROP INDEX `uk_news_medal_user_timeline`;
ALTER TABLE `news_medal_records`
  ADD UNIQUE KEY `uk_news_medal_user_timeline_mode` (`user_id`, `timeline_id`, `mode`);
