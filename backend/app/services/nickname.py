"""昵称推荐服务：预设模板组合 + 唯一性检查（参考 joy_word）"""
import random
import re
from typing import List

from sqlalchemy.orm import Session

from ..models import User

TEMPLATES = [
    "{形容词}{名词}",
    "{形容词}{名词}{后缀}",
    "{动词}{地点}",
    "{颜色}{动物}",
    "{自然}{名词}",
    "{形容词}{地点}",
    "{名词}{后缀}",
]

POOLS = {
    '形容词': [
        '神秘', '遥远', '自由', '勇敢', '快乐', '温柔', '闪耀', '宁静',
        '灿烂', '浪漫', '清新', '酷炫', '优雅', '调皮', '温暖', '梦幻',
        '辽阔', '苍茫', '静谧', '无畏', '孤独', '炽热',
    ],
    '名词': [
        '地图', '指南针', '罗盘', '经纬线', '等高线', '旅者', '探索者', '坐标',
        '路标', '灯塔', '峡谷', '高原', '岛屿', '半岛', '绿洲', '冰川',
        '三角洲', '海岸线', '山脊', '盆地', '星辰', '海洋', '森林', '山川',
    ],
    '后缀': [
        '君', '酱', '宝', '侠', '队长', '达人', '大师', '新手',
        '探险家', '领航员', '水手', '骑士', '行者', '向导',
    ],
    '动词': [
        '漫步', '追寻', '穿越', '探索', '环游', '发现', '抵达', '远行',
        '航行', '攀登', '俯瞰', '丈量', '巡游', '漂流',
    ],
    '地点': [
        '山川', '湖海', '荒漠', '雪原', '雨林', '草原', '极地', '海岸',
        '山巅', '云端', '天涯', '边境', '峡谷', '群岛', '冰原', '沙洲',
    ],
    '颜色': [
        '蓝色', '金色', '银色', '翠绿', '深红', '紫色', '天蓝', '青灰',
        '橙黄', '雪白',
    ],
    '动物': [
        '猎鹰', '海豚', '信鸽', '骆驼', '驯鹿', '雪豹', '北极熊', '海鸥',
        '鲸鱼', '藏羚羊', '鸵鸟', '企鹅',
    ],
    '自然': [
        '季风', '洋流', '极光', '晨曦', '晚霞', '星空', '云海', '潮汐',
        '信风', '暖流', '雾霭', '雷暴',
    ],
}


def _generate_candidates() -> List[str]:
    """生成一批候选昵称"""
    nicknames = []
    for template in TEMPLATES:
        parts = re.findall(r'\{(\w+)\}', template)
        if all(p in POOLS for p in parts):
            for _ in range(3):
                selected = [random.choice(POOLS[p]) for p in parts]
                nicknames.append(''.join(selected))
    random.shuffle(nicknames)
    return nicknames


class NicknameService:
    def recommend(self, db: Session, count: int = 8) -> List[str]:
        """推荐昵称（保证与已有用户不重复）"""
        recommended: List[str] = []
        seen = set()

        for _ in range(20):
            candidates = _generate_candidates()
            for nickname in candidates:
                if nickname in seen:
                    continue
                exists = db.query(User).filter(User.nickname == nickname).first()
                if not exists:
                    recommended.append(nickname)
                    seen.add(nickname)
                    if len(recommended) >= count:
                        return recommended

        # 不足则用数字后缀兜底
        while len(recommended) < count:
            fallback = f"旅行家{random.randint(1000, 9999)}"
            if fallback in seen:
                continue
            exists = db.query(User).filter(User.nickname == fallback).first()
            if not exists:
                recommended.append(fallback)
                seen.add(fallback)

        return recommended


nickname_service = NicknameService()
