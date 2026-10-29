-- ============================================================
-- poi_themes 封面图地址更新为 OSS 地址（幂等，可重复执行）
-- 生成方式: cd backend && python3 -m scripts.upload_theme_covers_to_oss
-- ============================================================

UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/university_211.jpg' WHERE `code` = 'university_211';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/historic_city.jpg' WHERE `code` = 'historic_city';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/museum_l1.jpg' WHERE `code` = 'museum_l1';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/unesco_whs.jpg' WHERE `code` = 'unesco_whs';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/scenic_5a.jpg' WHERE `code` = 'scenic_5a';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/peak_famous.jpg' WHERE `code` = 'peak_famous';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/lake_famous.jpg' WHERE `code` = 'lake_famous';
UPDATE `poi_themes` SET `cover_url` = 'https://map-find.oss-cn-beijing.aliyuncs.com/covers/themes/airport_major.jpg' WHERE `code` = 'airport_major';
