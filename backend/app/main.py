import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from loguru import logger

from .api.game import router as game_router
from .api.auth import router as auth_router
from .api.pk import router as pk_router
from .api.admin import router as admin_router
from .api.collection import router as collection_router, medal_router
from .api.news import router as news_router
from .database import Base, engine


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 地图寻踪 服务启动中...")
    Base.metadata.create_all(bind=engine)
    logger.info("✅ 数据库表初始化完成")
    yield
    logger.info("👋 地图寻踪 服务已关闭")


app = FastAPI(title="地图寻踪", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 静态资源（POI 封面图等）
_STATIC_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "static"
)
os.makedirs(_STATIC_DIR, exist_ok=True)
app.mount("/static", StaticFiles(directory=_STATIC_DIR), name="static")

app.include_router(game_router)
app.include_router(auth_router)
app.include_router(pk_router)
app.include_router(admin_router)
app.include_router(collection_router)
app.include_router(medal_router)
app.include_router(news_router)


@app.get("/api/health")
def health():
    return {"status": "ok", "game": "map-tracker"}
