-- 用现有 region.lng/lat 粗略填充 bbox（占位，后续可修正为真实行政区边界）
-- 对应 docs/hint-system-and-shape-display-plan.md 方案 3.4
--
-- 说明：
-- - 每个省以自身 lng/lat 为中心 ±3° 作为 bbox（省级行政区跨度大，±3° 占位）
-- - 每个市以自身 lng/lat 为中心 ±1° 作为 bbox（市级行政区跨度小，±1° 占位）
-- - 仅填充 bbox 为空的行，可重复执行
-- - 边界粗糙，跨省边缘可能误判；服务端在 bbox 为空时仍回退到 lng/lat 最近匹配
--
-- 执行方式：
--   mysql -u <user> -p map_game < scripts/fill_region_bbox.sql

-- 省级（level=1）：±3°
UPDATE regions
SET bbox_w = lng - 3, bbox_e = lng + 3,
    bbox_s = lat - 3, bbox_n = lat + 3
WHERE level = 1
  AND lng IS NOT NULL AND lat IS NOT NULL
  AND bbox_w IS NULL;

-- 市级（level=2）：±1°
UPDATE regions
SET bbox_w = lng - 1, bbox_e = lng + 1,
    bbox_s = lat - 1, bbox_n = lat + 1
WHERE level = 2
  AND lng IS NOT NULL AND lat IS NOT NULL
  AND bbox_w IS NULL;
