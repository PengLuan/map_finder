# 猜地图项目 — 新主题 & 全量封面部署指南

> 生成日期：2026-08-14
> 涉及数据库：map_find（生产环境）

---

## 一、部署文件清单

| 序号 | SQL 文件 | 说明 | 操作类型 |
|---|---|---|---|
| 1 | `river_source_online.sql` | 江河之源主题（105 条 POI + 1 主题行） | 先删后插（幂等） |
| 2 | `famous_buildings_online.sql` | 华夏建筑主题（313 条 POI + 1 主题行） | 先删后插（幂等） |
| 3 | `famous_bridges_online.sql` | 中华桥梁主题（221 条 POI + 1 主题行） | 先删后插（幂等） |
| 4 | `train_stations_online.sql` | 车站寻踪主题（315 条 POI + 1 主题行） | 先删后插（幂等） |
| 5 | `update_all_poi_covers.sql` | 全量封面更新（5017 条 UPDATE + 1 条 DELETE） | 按ID更新（幂等） |

所有 SQL 均为幂等脚本，可重复执行。

---

## 二、新增主题概览

| 主题 | code | id | icon | group_name | sort_order | POI 数 | ID 范围 |
|---|---|---|---|---|---|---|---|
| 江河之源 | river_source | 17 | 💧 | 自然风光 | 9 | 105 | 4881~5008 |
| 华夏建筑 | famous_buildings | 18 | 🏯 | 人文景观 | 10 | 313 | 5101~5413 |
| 中华桥梁 | famous_bridges | 19 | 🌉 | 人文景观 | 11 | 221 | 5501~5721 |
| 车站寻踪 | train_stations | 20 | 🚄 | 人文景观 | 12 | 315 | 5801~6115 |

**合计新增 954 条 POI**，全部为 `point` 类型、`radius_km=0`、`area_review=1`（待核定）、`source='manual'`。

---

## 三、部署前置条件

1. **数据库**：`pois` 表需已包含 `shape_type`、`radius_km`、`area_geojson`、`area_review`、`verify_status`、`source` 字段（由 `migrate_admin_ugc.sql` 迁移）
2. **OSS**：封面图已全部上传至 `https://map-find.oss-cn-beijing.aliyuncs.com/covers/`，Bucket 为公共读
3. **数据库连接**：`mysql -umap_find -p<密码> map_find`

---

## 四、部署步骤

### 步骤 1：备份（可选但建议）

```bash
mysqldump -umap_find -p map_find pois poi_themes > backup_pois_$(date +%Y%m%d).sql
```

### 步骤 2：按顺序执行 SQL

```bash
# 1. 导入江河之源主题（105 条）
mysql -umap_find -pspZMKChdZbZh4Zhc map_find < river_source_online.sql

# 2. 导入华夏建筑主题（313 条）
mysql -umap_find -pspZMKChdZbZh4Zhc map_find < famous_buildings_online.sql

# 3. 导入中华桥梁主题（221 条）
mysql -umap_find -pspZMKChdZbZh4Zhc map_find < famous_bridges_online.sql

# 4. 导入车站寻踪主题（315 条）
mysql -umap_find -pspZMKChdZbZh4Zhc map_find < train_stations_online.sql

# 5. 更新全量封面 cover_url（5017 条 UPDATE + 删除1条测试数据）
mysql -umap_find -pspZMKChdZbZh4Zhc map_find < update_all_poi_covers.sql
```

### 步骤 3：验证

```sql
-- 检查各主题 POI 数量
SELECT category, COUNT(*) FROM pois GROUP BY category ORDER BY category;

-- 检查四个新主题
SELECT id, code, name, sort_order, enabled FROM poi_themes WHERE code IN ('river_source','famous_buildings','famous_bridges','train_stations');

-- 检查封面覆盖率
SELECT 
  COUNT(*) AS total,
  SUM(CASE WHEN cover_url LIKE 'https://map-find.oss%' THEN 1 ELSE 0 END) AS has_cover,
  SUM(CASE WHEN cover_url IS NULL OR cover_url='' THEN 1 ELSE 0 END) AS no_cover
FROM pois;

-- 检查测试数据是否已删除
SELECT * FROM pois WHERE id=4880;
```

**预期结果**：
- `river_source`: 105 条
- `famous_buildings`: 313 条
- `famous_bridges`: 221 条
- `train_stations`: 315 条
- 总 POI 数：5017（删除测试数据 4880 后）
- 封面覆盖率：100%（5017/5017）

### 步骤 4：重启后端

```bash
# 查找后端进程
ps aux | grep gunicorn

# 优雅重启
kill -HUP <主进程PID>

# 或重新启动
/www/server/pyporject_evn/map/bin/gunicorn -c gunicorn_conf.py main:app -D
```

### 步骤 5：前端验证

访问 `https://word.zhizhang.me/`（或对应域名），在主题选择页面确认四个新主题可见且可正常选题游戏。

---

## 五、封面图说明

- **存储位置**：阿里云 OSS `map-find` Bucket，`covers/{id}.jpg`
- **公网访问**：`https://map-find.oss-cn-beijing.aliyuncs.com/covers/{id}.jpg`
- **主题封面**：`covers/themes/{theme_code}.jpg`
  - `covers/themes/river_source.jpg`
  - `covers/themes/famous_buildings.jpg`
  - `covers/themes/famous_bridges.jpg`
  - `covers/themes/train_stations.jpg`
- **图片格式**：JPEG（22 条历史 POI 为 PNG，均可正常访问）
- **全部封面均经 HTTP 200 校验**

---

## 六、回滚方案

如需回滚新增主题：

```sql
DELETE FROM pois WHERE category IN ('river_source','famous_buildings','famous_bridges','train_stations');
DELETE FROM poi_themes WHERE code IN ('river_source','famous_buildings','famous_bridges','train_stations');
```

封面 UPDATE 语句为幂等操作，无需回滚（只是把 cover_url 设为 OSS 地址，不影响数据结构）。

---

## 七、注意事项

1. **SQL 执行顺序**：先执行四个主题 SQL，再执行全量封面 UPDATE。因为主题 SQL 包含完整的 cover_url，全量 UPDATE 是兜底保障
2. **幂等性**：所有 SQL 可重复执行，重复执行不会产生重复数据
3. **外键约束**：主题 SQL 执行前会自动断开 game_records 和 pk_games 中对被删除 POI 的引用（SET NULL）
4. **area_review=1**：所有新增 POI 均为待核定状态，后续可通过后台管理面板逐条审核确认
5. **难度分布**：四个主题的难度 d1~d5 均有覆盖，easy 模式（难度≤3）有充足题库
