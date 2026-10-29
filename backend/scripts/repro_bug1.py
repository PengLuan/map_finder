"""复现 bug1b：非省会/省界附近的省份提示错误。"""
import sys
sys.path.insert(0, '.')

from app.database import SessionLocal
from app.services.game import current_location_text

cases = [
    ("河北廊坊(京津之间)", 116.70, 39.53),
    ("河北唐山", 118.18, 39.63),
    ("河北保定", 115.48, 38.87),
    ("江苏苏州", 120.58, 31.30),
    ("浙江嘉兴", 120.76, 30.75),
    ("广东东莞", 113.75, 23.02),
    ("海南三亚", 109.51, 18.25),
    ("内蒙古鄂尔多斯", 109.78, 39.61),
    ("甘肃酒泉(很大)", 98.50, 39.74),
    ("新疆喀什", 75.99, 39.47),
    ("西藏那曲", 92.05, 31.48),
    ("青海格尔木", 94.90, 36.40),
    ("四川攀枝花", 101.72, 26.58),
    ("云南普洱", 100.97, 22.79),
    ("黑龙江漠河", 122.54, 52.97),
]
db = SessionLocal()
for name, lng, lat in cases:
    print(f"{name} ({lng},{lat}) -> {current_location_text(db, lng, lat)}")
db.close()
