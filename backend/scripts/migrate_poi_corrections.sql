-- POI 纠正功能（2026-09 第二期）
-- 适用于已有库；全新库由 Base.metadata.create_all 自动建表，无需执行。

CREATE TABLE IF NOT EXISTS `poi_corrections` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `poi_id` INT NOT NULL COMMENT '被纠正的 POI',
  `session_id` VARCHAR(64) NOT NULL COMMENT '提交者设备标识',
  `nickname` VARCHAR(32) NULL DEFAULT NULL COMMENT '提交者昵称',
  `name` VARCHAR(128) NULL DEFAULT NULL COMMENT '纠正快照：名称',
  `category` VARCHAR(32) NULL DEFAULT NULL COMMENT '纠正快照：分类',
  `lng` DOUBLE NULL DEFAULT NULL COMMENT '纠正快照：经度',
  `lat` DOUBLE NULL DEFAULT NULL COMMENT '纠正快照：纬度',
  `description` TEXT NULL COMMENT '纠正快照：简介（写回 poi.summary）',
  `cover_url` VARCHAR(512) NULL DEFAULT NULL COMMENT '纠正快照：封面图',
  `suggested_shape_type` VARCHAR(10) NULL DEFAULT NULL COMMENT '纠正快照：形态 point/circle/polygon',
  `suggested_radius_km` DOUBLE NULL DEFAULT NULL COMMENT '纠正快照：圆形半径',
  `suggested_area_geojson` TEXT NULL COMMENT '纠正快照：多边形 GeoJSON',
  `status` VARCHAR(20) NOT NULL DEFAULT 'pending' COMMENT 'pending/adopted/rejected',
  `reviewer_note` VARCHAR(256) NULL DEFAULT NULL COMMENT '审核备注',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `adopted_at` DATETIME NULL DEFAULT NULL COMMENT '采纳时间',
  PRIMARY KEY (`id`),
  KEY `ix_poi_corrections_poi_id` (`poi_id`),
  KEY `ix_poi_corrections_session_id` (`session_id`),
  KEY `ix_poi_corrections_status` (`status`),
  KEY `ix_poi_corrections_created_at` (`created_at`),
  CONSTRAINT `fk_poi_corrections_poi` FOREIGN KEY (`poi_id`) REFERENCES `pois` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
