#!/bin/bash
# 一键部署（Docker Compose 全栈：应用 + PostgreSQL）
#
# 用法：
#   bash scripts/docker-deploy.sh            # 交互式（会提示确认端口占用）
#   ASSUME_YES=1 bash scripts/docker-deploy.sh   # 非交互（CI / 首次跑通）
#
# 说明：
#   - 需要 docker compose v2（`docker compose`）或旧版 `docker-compose`
#   - 首次运行若缺 .env，会生成随机 DB_PASSWORD 并写入 .env（.env 不入库）
#   - 健康检查走应用容器的 /health（容器内 3000，宿主由 APP_PORT 决定，默认 80）

set -euo pipefail

APP_PORT="${APP_PORT:-80}"
POSTGRES_PORT="${POSTGRES_PORT:-5433}"
ASSUME_YES="${ASSUME_YES:-0}"

say() { printf '%s\n' "$*"; }
die() { printf '错误: %s\n' "$*" >&2; exit 1; }

say "=========================================="
say " Silicon Meridian - Docker 一键部署"
say "=========================================="

# ---------- 1. 环境检查 ----------
command -v docker >/dev/null 2>&1 || die "未安装 Docker，请先安装：https://docs.docker.com/get-docker/"

if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  die "未找到 docker compose（v2 插件）或 docker-compose（v1）。建议升级 Docker Desktop / 安装 compose 插件。"
fi
say "✓ 使用：$COMPOSE"

# ---------- 2. .env（DB_PASSWORD 是必填项，缺了 Postgres 起不来） ----------
if [ ! -f .env ]; then
  say "未发现 .env，正在生成（随机 DB_PASSWORD）..."
  if command -v openssl >/dev/null 2>&1; then
    GENERATED_PASSWORD="$(openssl rand -base64 24 | tr -d '\n/+=' | cut -c1-28)"
  else
    GENERATED_PASSWORD="$(date +%s%N | sha256sum | cut -c1-28)"
  fi
  cat > .env <<EOF
# 由 scripts/docker-deploy.sh 生成（请勿提交到仓库）
DB_PASSWORD=${GENERATED_PASSWORD}
APP_PORT=${APP_PORT}
POSTGRES_PORT=${POSTGRES_PORT}
DATABASE_SSL=false
EOF
  say "✓ 已写入 .env（DB_PASSWORD 为随机值，请妥善保存）"
fi

if ! grep -qE '^[[:space:]]*DB_PASSWORD=.+' .env; then
  die ".env 中缺少 DB_PASSWORD（compose 的 Postgres 需要它）。请补上：DB_PASSWORD=<一个长随机串>"
fi

# 把 APP_PORT / POSTGRES_PORT 从 .env 读回来，保证健康检查打对端口
ENV_APP_PORT="$(grep -E '^[[:space:]]*APP_PORT=' .env | tail -1 | cut -d= -f2 | tr -d ' \r' || true)"
ENV_PG_PORT="$(grep -E '^[[:space:]]*POSTGRES_PORT=' .env | tail -1 | cut -d= -f2 | tr -d ' \r' || true)"
[ -n "${ENV_APP_PORT:-}" ] && APP_PORT="$ENV_APP_PORT"
[ -n "${ENV_PG_PORT:-}" ] && POSTGRES_PORT="$ENV_PG_PORT"

# ---------- 3. 端口占用检查 ----------
check_port() {
  local port="$1" label="$2"
  if command -v lsof >/dev/null 2>&1 && lsof -Pi ":$port" -sTCP:LISTEN -t >/dev/null 2>&1; then
    say "警告: 端口 $port（$label）已被占用"
    if [ "$ASSUME_YES" != "1" ]; then
      read -r -p "是否继续? (y/N) " reply
      [[ "$reply" =~ ^[Yy]$ ]] || die "已取消。可改 .env 里的 APP_PORT / POSTGRES_PORT 换个端口。"
    fi
  fi
}
check_port "$APP_PORT" "应用"
check_port "$POSTGRES_PORT" "PostgreSQL"

# ---------- 4. 构建并启动 ----------
say "开始构建镜像（首次可能需要几分钟）..."
$COMPOSE build

say "启动服务..."
$COMPOSE up -d

# ---------- 5. 等待健康（应用容器 /health） ----------
say "等待应用就绪..."
HEALTH_URL="http://127.0.0.1:${APP_PORT}/health"
for i in $(seq 1 30); do
  if command -v curl >/dev/null 2>&1 && curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    say "✓ 健康检查通过：$HEALTH_URL"
    break
  fi
  if [ "$i" = "30" ]; then
    say "⚠ 60 秒内未通过健康检查。请查看日志定位：$COMPOSE logs -f app"
  fi
  sleep 2
done

$COMPOSE ps

say ""
say "=========================================="
say " 部署完成"
say "=========================================="
say "应用地址   : http://localhost:${APP_PORT}"
say "健康检查   : ${HEALTH_URL}"
say "PostgreSQL : localhost:${POSTGRES_PORT}（库 silicon_meridian / 用户 meridian）"
say ""
say "常用命令："
say "  日志   : $COMPOSE logs -f"
say "  停止   : $COMPOSE stop"
say "  重启   : $COMPOSE restart"
say "  卸载   : $COMPOSE down            # 加 -v 会同时删除数据库卷"
say ""
say "可选增强（Scrapling 抓取，不在 compose 内）："
say "  python scrapling_server.py   # 默认 :5000，再在 .env 里设 SCRAPLING_URL"
