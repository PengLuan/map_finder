-- 意见留言表
-- 手动导入：mysql -u map_find -p map_find < feedback.sql

CREATE TABLE IF NOT EXISTS feedback (
    id INT AUTO_INCREMENT PRIMARY KEY,
    content TEXT NOT NULL COMMENT '留言内容',
    image_urls TEXT NULL COMMENT '图片URL列表(JSON数组)',
    contact VARCHAR(100) NULL COMMENT '联系方式(可选)',
    nickname VARCHAR(50) NULL COMMENT '称呼(可选)',
    ip VARCHAR(45) NOT NULL COMMENT '提交者IP',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '提交时间',
    INDEX idx_created (created_at DESC)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='意见留言';
