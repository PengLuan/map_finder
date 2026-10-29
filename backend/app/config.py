from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # MySQL
    mysql_host: str = "localhost"
    mysql_port: int = 3306
    mysql_user: str = "root"
    mysql_password: str = "123456"
    mysql_database: str = "map_game"

    # JWT
    jwt_secret: str = "map-game-secret-key-change-in-production"
    jwt_expire_days: int = 30

    # 测试模式（验证码固定 123456，不发邮件）
    testing: bool = False

    # 邮箱 SMTP（邮箱登录验证码；字段名与织章主项目 .env 的 SMTP_* 对齐）
    smtp_host: str = ""
    smtp_port: int = 465
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from_name: str = "地图寻踪"
    smtp_from: str = "247247247@qq.com"

    # Redis（邮箱验证码存储，多 worker 共享）
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""
    redis_db: int = 0

    # 天地图
    tianditu_key: str = ""

    # 高德 Web 服务 Key（地理编码 / Place 搜索）
    amap_web_key: str = ""

    # 后台管理（用户名 + 密码认证，登录后用密码作为 Bearer Token）
    admin_username: str = "admin"
    admin_password: str = ""
    # 兼容旧配置：若设置了 admin_token 且密码为默认值，则回退到 admin_token
    admin_token: str = ""

    # 阿里云 OSS（UGC 封面图转存）
    oss_access_key_id: str = ""
    oss_access_key_secret: str = ""
    oss_endpoint: str = ""
    oss_bucket_name: str = ""
    oss_cover_prefix: str = "ugc-covers"

    # 游戏配置
    national_tolerance_km: float = 5.0
    provincial_tolerance_km: float = 2.0
    city_tolerance_km: float = 0.5

    national_time_limit: int = 300
    provincial_time_limit: int = 180
    city_time_limit: int = 120

    @property
    def mysql_url(self) -> str:
        return (
            f"mysql+pymysql://{self.mysql_user}:{self.mysql_password}"
            f"@{self.mysql_host}:{self.mysql_port}/{self.mysql_database}"
            f"?charset=utf8mb4"
        )

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
