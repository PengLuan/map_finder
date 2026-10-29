#!/usr/bin/env bash
# =============================================================================
# 地图寻踪 · 本地一键启动（含「小寻带你看新闻」功能）
# -----------------------------------------------------------------------------
# 用法：  ./start_local.sh          （在 map/ 目录下执行）
# 停止：  Ctrl+C（同时结束后端）
#
# 流程：
#   1. 环境检查（Python 依赖 / MySQL 连通性）
#   2. 幂等应用新闻功能 DDL + 2026-10 批次数据（已存在则跳过）
#   3. 启动后端 uvicorn → http://localhost:8010
#   4. 启动前端 vite    → http://localhost:3001（已代理 /api、/static）
#   5. 自动打开浏览器
#
# 端口说明：后端用 8010，避免与本机其他项目常驻的 8000 冲突（生产由 Nginx 代理，不受影响）
#
# 测试入口：
#   - 游戏首页     http://localhost:3001 → 点击「📰 小寻带你看新闻」
#   - 后台核定     http://localhost:3001/#/admin → 左侧「新闻时间线」
#     （账号见 backend/.env 的 ADMIN_USERNAME / ADMIN_PASSWORD）
#
# 说明：
#   - 本地 MySQL 默认 root/123456/map_game（与 app/config.py 默认值一致，可环境变量覆盖）
#   - TESTING=true 使邮箱登录验证码固定为 123456
#   - 新闻数据初始全部为 pending（待核定），前端默认不可见：
#     请先到后台「新闻时间线」把 POI 改"已核定"、时间线改"已审核"后再测玩法
# =============================================================================
set -euo pipefail

MAP_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$MAP_DIR/backend"
FRONTEND_DIR="$MAP_DIR/frontend"

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
  echo "      PYTHON=/Users/luanpeng/anaconda3/envs/zhizhang/bin/python $0"
  exit 1
fi

echo "==> [1/4] 检查数据库 $MYSQL_DATABASE ..."
if ! $MYSQL -N -e "SELECT 1" >/dev/null 2>&1; then
  echo "错误：无法连接 MySQL（${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}）。"
  echo "      请确认本地 MySQL 已启动，或用环境变量覆盖连接信息："
  echo "      MYSQL_HOST=... MYSQL_PORT=... MYSQL_USER=... MYSQL_PWD=... MYSQL_DATABASE=... $0"
  exit 1
fi
echo "    数据库连接正常"

# ---- 2. 幂等应用新闻功能表与数据 ----
echo "==> [2/4] 应用新闻功能 DDL + 数据 ..."

if $MYSQL -N -e "SHOW TABLES LIKE 'news_timelines'" 2>/dev/null | grep -q news_timelines; then
  echo "    新闻表已存在，跳过 DDL"
else
  $MYSQL < "$BACKEND_DIR/scripts/news_202610_ddl.sql"
  echo "    已执行 news_202610_ddl.sql"
fi

NEWS_TL_CNT=$($MYSQL -N -e "SELECT COUNT(*) FROM news_timelines" 2>/dev/null | tr -d '[:space:]')
NEWS_POI_CNT=$($MYSQL -N -e "SELECT COUNT(*) FROM news_pois" 2>/dev/null | tr -d '[:space:]')
if [ "${NEWS_TL_CNT:-0}" -ge 4 ] && [ "${NEWS_POI_CNT:-0}" -ge 20 ]; then
  echo "    新闻数据已就绪（时间线 ${NEWS_TL_CNT} / POI ${NEWS_POI_CNT}），跳过"
else
  if [ "${NEWS_TL_CNT:-0}" -gt 0 ] || [ "${NEWS_POI_CNT:-0}" -gt 0 ]; then
    echo "    检测到残留数据（时间线 ${NEWS_TL_CNT:-0}/POI ${NEWS_POI_CNT:-0}），先清空再重灌 ..."
    $MYSQL -e "SET FOREIGN_KEY_CHECKS=0; TRUNCATE news_progress; TRUNCATE news_pois; TRUNCATE news_timelines; SET FOREIGN_KEY_CHECKS=1;"
  fi
  $MYSQL < "$BACKEND_DIR/scripts/news_202610_data.sql"
  echo "    已执行 news_202610_data.sql（4 条时间线 / 20 个 POI，全部待核定）"
fi

# 新闻勋章增量（medal_icon_url 列 + news_medal_records 表）
if $MYSQL -N -e "SHOW COLUMNS FROM news_timelines LIKE 'medal_icon_url'" 2>/dev/null | grep -q medal_icon_url; then
  echo "    新闻勋章字段已就绪，跳过增量"
else
  $MYSQL < "$BACKEND_DIR/scripts/news_medal_upgrade.sql"
  echo "    已执行 news_medal_upgrade.sql"
fi

# 进度/勋章按模式（easy/hard）独立增量
if $MYSQL -N -e "SHOW COLUMNS FROM news_progress LIKE 'mode'" 2>/dev/null | grep -q mode; then
  echo "    新闻模式进度字段已就绪，跳过增量"
else
  $MYSQL < "$BACKEND_DIR/scripts/news_mode_upgrade.sql"
  echo "    已执行 news_mode_upgrade.sql"
fi

# 新闻纠错反馈表
if $MYSQL -N -e "SHOW TABLES LIKE 'news_corrections'" 2>/dev/null | grep -q news_corrections; then
  echo "    新闻纠错表已存在，跳过"
else
  $MYSQL < "$BACKEND_DIR/scripts/news_corrections_upgrade.sql"
  echo "    已执行 news_corrections_upgrade.sql"
fi

# ---- 3. 启动后端 ----
BACKEND_PORT=8010
echo "==> [3/4] 启动后端 (http://localhost:${BACKEND_PORT}) ..."
OLD_PID="$(lsof -ti :${BACKEND_PORT} 2>/dev/null || true)"
if [ -n "$OLD_PID" ]; then
  echo "    端口 ${BACKEND_PORT} 已被进程 $OLD_PID 占用，先杀掉 ..."
  kill $OLD_PID 2>/dev/null || true
  sleep 1
fi
TESTING=true "$PYTHON" -m uvicorn app.main:app \
  --app-dir "$BACKEND_DIR" \
  --host 0.0.0.0 --port ${BACKEND_PORT} \
  > >(while IFS= read -r line; do printf '[%s] %s\n' "$(date '+%m-%d %H:%M:%S')" "$line"; done) 2>&1 &
BACKEND_PID=$!

# 脚本退出时结束后端进程
trap 'kill $BACKEND_PID 2>/dev/null || true' EXIT

# 等待后端就绪（最长 15 秒）
for i in $(seq 1 15); do
  if curl -sf http://localhost:${BACKEND_PORT}/api/health >/dev/null 2>&1; then
    echo "    后端已就绪"
    break
  fi
  if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo "错误：后端启动失败，请检查上方日志"
    exit 1
  fi
  sleep 1
done

# ---- 4. 启动前端 ----
echo "==> [4/4] 启动前端 (http://localhost:3001) ..."
echo "    -------------------------------------------"
echo "    游戏首页  http://localhost:3001"
echo "              → 点击「📰 小寻带你看新闻」测玩法"
echo "    后台核定  http://localhost:3001/#/admin"
echo "              → 「新闻时间线」核定 POI / 上线时间线"
echo "    提示：TESTING 模式下邮箱登录验证码固定为 123456"
echo "    按 Ctrl+C 停止前端并结束后端"
echo "    -------------------------------------------"

# 延迟自动打开浏览器（等 vite 起来）
(
  sleep 3
  if command -v open >/dev/null 2>&1; then
    open "http://localhost:3001" 2>/dev/null || true
  fi
) &

cd "$FRONTEND_DIR"
npm run dev
