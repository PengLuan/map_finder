#!/usr/bin/env bash
# =============================================================================
# 地图寻踪 · 专题模式 本地一键启动脚本
# -----------------------------------------------------------------------------
# 用法：  ./start_local.sh
# 功能：
#   1. 幂等初始化本地数据库（专题表迁移 + 补齐六大古都 POI + 专题种子数据）
#   2. 启动后端 uvicorn（http://localhost:8000）
#   3. 启动前端 vite（http://localhost:3001，前端已代理 /api、/static 到 8000）
#
# 说明：
#   - 本地 MySQL 默认 root/123456/map_game（与 app/config.py 默认值一致）
#   - TESTING=true 使邮箱登录验证码固定为 123456，方便本地测试登录
#   - 停止：Ctrl+C（会同时结束后端进程）
# =============================================================================
set -euo pipefail

BACKEND_DIR="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$BACKEND_DIR/../frontend"

# ---- MySQL 连接（可通过环境变量覆盖）----
MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3306}"
MYSQL_USER="${MYSQL_USER:-root}"
MYSQL_DATABASE="${MYSQL_DATABASE:-map_game}"
export MYSQL_PWD="${MYSQL_PWD:-123456}"

MYSQL="mysql -h${MYSQL_HOST} -P${MYSQL_PORT} -u${MYSQL_USER} -D ${MYSQL_DATABASE}"

# ---- Python 解释器（优先 zhizhang conda env）----
PYTHON="${PYTHON:-/Users/luanpeng/anaconda3/envs/zhizhang/bin/python}"
if [ ! -x "$PYTHON" ]; then
  PYTHON="$(command -v python3 || true)"
fi

echo "==> 使用 Python: $PYTHON"
if ! "$PYTHON" -c "import fastapi, uvicorn, sqlalchemy, pymysql, jwt" >/dev/null 2>&1; then
  echo "错误：Python 环境缺少后端依赖（fastapi/uvicorn/sqlalchemy/pymysql/jwt）。"
  echo "      请设置 PYTHON 变量指向正确环境，例如："
  echo "      PYTHON=/Users/luanpeng/anaconda3/envs/zhizhang/bin/python ./start_local.sh"
  exit 1
fi

# ---- 1. 初始化数据库 ----
echo "==> [1/3] 初始化数据库 ..."

# 1.0 基础迁移（本地旧库可能缺字段：game_records/pk_games/regions 的提示积分与 bbox 字段）
if $MYSQL -N -e "SHOW COLUMNS FROM game_records LIKE 'device'" 2>/dev/null | grep -q device; then
  echo "    提示积分字段已就绪，跳过 hint_credits 迁移"
else
  $MYSQL < "$BACKEND_DIR/scripts/migrate_hint_credits.sql"
  echo "    已执行 migrate_hint_credits.sql"
fi

# 1.0b ip_region 迁移（player_sessions 的 IP 归属地字段）
if $MYSQL -N -e "SHOW COLUMNS FROM player_sessions LIKE 'ip_region'" 2>/dev/null | grep -q ip_region; then
  echo "    player_sessions.ip_region 已存在，跳过 ip_region 迁移"
else
  $MYSQL < "$BACKEND_DIR/scripts/migrate_ip_region.sql"
  echo "    已执行 migrate_ip_region.sql"
fi

# 1.1 专题表迁移（collections 表不存在时才执行，避免重复 ALTER 报错）
if $MYSQL -N -e "SHOW TABLES LIKE 'collections'" 2>/dev/null | grep -q collections; then
  echo "    专题表已存在，跳过迁移"
else
  $MYSQL < "$BACKEND_DIR/scripts/migrate_collection_mode.sql"
  echo "    已执行 migrate_collection_mode.sql"
fi

# 1.2 生成 100 个专题数据（幂等；含补录 POI + 星级 + medals）
COLL_CNT=$($MYSQL -N -e "SELECT COUNT(*) FROM collections" 2>/dev/null | tr -d '[:space:]')
if [ -n "$COLL_CNT" ] && [ "$COLL_CNT" -ge 90 ] 2>/dev/null; then
  echo "    专题数据已就绪（$COLL_CNT 个），跳过生成"
else
  echo "    生成 100 个专题数据 ..."
  "$PYTHON" "$BACKEND_DIR/scripts/generate_collections_100.py"
fi

# 1.3 补录 POI 封面图（幂等；复用现有 POI 真实封面图）
"$PYTHON" "$BACKEND_DIR/scripts/fix_poi_covers.py" >/dev/null
echo "    POI 封面图已就绪"

# 1.4 专题封面图（幂等；复用现有 POI 真实封面图，无 text_to_image）
echo "    校验专题封面图 ..."
"$PYTHON" "$BACKEND_DIR/scripts/upload_collection_covers.py" >/dev/null
echo "    专题封面图已就绪"

# 1.5 专题预告卡 description（幂等；3 句文化背景）
"$PYTHON" "$BACKEND_DIR/scripts/generate_collection_descriptions.py" >/dev/null
echo "    专题预告卡描述已就绪"

# ---- 2. 启动后端 ----
echo "==> [2/3] 启动后端 (http://localhost:8000) ..."
# 杀掉占用 8000 端口的旧进程，确保跑的是最新代码
OLD_PID="$(lsof -ti :8000 2>/dev/null || true)"
if [ -n "$OLD_PID" ]; then
  echo "    端口 8000 已被进程 $OLD_PID 占用，先杀掉 ..."
  kill $OLD_PID 2>/dev/null || true
  sleep 1
fi
TESTING=true "$PYTHON" -m uvicorn app.main:app \
  --app-dir "$BACKEND_DIR" \
  --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

# 脚本退出时结束后端进程
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

# 等待后端就绪
sleep 2

# ---- 3. 启动前端 ----
echo "==> [3/3] 启动前端 (http://localhost:3001) ..."
echo "    提示：TESTING 模式下邮箱登录验证码固定为 123456"
echo "    按 Ctrl+C 停止前端并结束后端"
cd "$FRONTEND_DIR"
npm run dev
