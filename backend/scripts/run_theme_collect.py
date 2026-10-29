#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
主题种子收集多进程启动器

参考 joy_word/backend/scripts/build_2/run_parallel.py 的模式：
  - 启动 N 个 worker 子进程，每个处理 hash(name) % N 的分区
  - 实时监控进度，每 5 秒刷新
  - 信号处理：Ctrl+C 终止所有子进程
  - PYTHONUNBUFFERED=1 确保子进程输出实时刷新

用法：
    cd backend
    python -m scripts.run_theme_collect --workers 30
    python -m scripts.run_theme_collect --workers 30 --categories university_211,scenic_5a
    python -m scripts.run_theme_collect --workers 10 --categories unesco_whs
"""
import argparse
import os
import re
import signal
import subprocess
import sys
import threading
import time
from pathlib import Path

# 脚本目录
SCRIPTS_DIR = Path(__file__).parent
WORKER_SCRIPT = SCRIPTS_DIR / "collect_theme_worker.py"


def read_process_output(proc, partition, progress_dict, lock):
    """实时读取子进程输出并提取进度"""
    progress_pattern = re.compile(r'PROGRESS (\d+)/(\d+)')
    skip_pattern = re.compile(r'SKIP (\d+)/(\d+)')

    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue

        skip_match = skip_pattern.search(line)
        if skip_match:
            with lock:
                progress_dict.setdefault(partition, {})
                progress_dict[partition]['skipped'] = int(skip_match.group(1))
                progress_dict[partition]['total_items'] = int(skip_match.group(2))

        match = progress_pattern.search(line)
        if match:
            processed = int(match.group(1))
            total = int(match.group(2))
            with lock:
                progress_dict[partition] = {
                    'processed': processed,
                    'total': total,
                    'pct': (processed / total * 100) if total > 0 else 0
                }


def run_parallel(workers, categories):
    """启动多进程收集"""
    if not WORKER_SCRIPT.exists():
        print(f"❌ Worker 脚本不存在: {WORKER_SCRIPT}")
        return

    # 统计待处理数量
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
        from scripts.theme_seeds_data import THEME_SEEDS
        cats = categories or list(THEME_SEEDS.keys())
        total_seeds = sum(len(THEME_SEEDS.get(c, [])) for c in cats)
        print(f"📋 主题: {', '.join(cats)}")
        print(f"📋 种子总数: {total_seeds}")
        for c in cats:
            print(f"   {c}: {len(THEME_SEEDS.get(c, []))} 条")
    except Exception:
        pass

    print(f"🚀 启动 {workers} 进程并行收集")
    print(f"{'=' * 70}")

    processes = []
    progress_dict = {}
    lock = threading.Lock()
    threads = []

    shutting_down = False

    def kill_all_children(signum=None, frame=None):
        nonlocal shutting_down
        shutting_down = True
        print(f"\n⚠️  收到中断信号，正在终止所有子进程...")
        for p in processes:
            if p.poll() is None:
                try:
                    p.terminate()
                except Exception:
                    pass
        time.sleep(2)
        for p in processes:
            if p.poll() is None:
                try:
                    p.kill()
                except Exception:
                    pass
        print(f"✅ 所有子进程已终止")
        sys.exit(1)

    signal.signal(signal.SIGINT, kill_all_children)
    signal.signal(signal.SIGTERM, kill_all_children)

    extra_args = []
    if categories:
        extra_args.extend(["--categories", ",".join(categories)])

    for i in range(workers):
        cmd = [
            sys.executable,
            str(WORKER_SCRIPT),
            "--partition", str(i),
            "--partition-total", str(workers),
        ] + extra_args

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            universal_newlines=True,
            env=env,
        )
        processes.append(proc)

        t = threading.Thread(target=read_process_output, args=(proc, i, progress_dict, lock))
        t.daemon = True
        t.start()
        threads.append(t)

    print(f"✅ 已启动 {workers} 个进程")
    print(f"{'=' * 70}\n")

    start_time = time.time()
    completed = 0
    last_displayed_progress = {}
    last_display_time = 0

    while completed < workers:
        completed = sum(1 for p in processes if p.poll() is not None)
        elapsed = time.time() - start_time

        with lock:
            progress_changed = False
            if progress_dict:
                current_progress = {
                    k: (v.get('processed'), v.get('total'))
                    for k, v in progress_dict.items()
                }
                if current_progress != last_displayed_progress:
                    last_displayed_progress = current_progress.copy()
                    progress_changed = True

        should_display = progress_changed or (elapsed - last_display_time >= 5)

        if should_display:
            last_display_time = elapsed
            if progress_dict:
                has_progress = any('processed' in p for p in progress_dict.values())
                total_skipped = sum(p.get('skipped', 0) for p in progress_dict.values())
                total_items = sum(p.get('total_items', 0) for p in progress_dict.values())

                if has_progress:
                    total_processed = sum(p.get('processed', 0) for p in progress_dict.values())
                    total_words = sum(p.get('total', 0) for p in progress_dict.values())
                    avg_pct = (total_processed / total_words * 100) if total_words > 0 else 0

                    print(f"\n{'=' * 70}")
                    print(f"⏱️  已运行 {int(elapsed)} 秒 | 进度: {completed}/{workers} 进程完成")
                    print(f"📊 总进度: {total_processed}/{total_words} ({avg_pct:.1f}%)")
                    if total_skipped > 0:
                        remaining = total_items - total_skipped
                        print(f"⏭️  跳过(已存在) {total_skipped}, 待处理 {remaining}")
                    print(f"{'=' * 70}\n")
                else:
                    alive = sum(1 for p in processes if p.poll() is None)
                    print(f"⏱️  已运行 {int(elapsed)} 秒 | {alive} 个进程运行中，等待首批完成...")
            else:
                alive = sum(1 for p in processes if p.poll() is None)
                print(f"⏱️  已运行 {int(elapsed)} 秒 | {alive} 个进程运行中，等待首批完成...")

        time.sleep(1)

    # 统计结果
    success_count = sum(1 for p in processes if p.returncode == 0)
    fail_count = workers - success_count

    print(f"\n{'=' * 70}")
    print(f"执行完成:")
    print(f"   ✅ 成功: {success_count} 个进程")
    if fail_count > 0:
        print(f"   ❌ 失败: {fail_count} 个进程")
    elapsed_min = int((time.time() - start_time) / 60)
    elapsed_sec = int(time.time() - start_time) % 60
    print(f"   ⏱️  耗时: {elapsed_min} 分 {elapsed_sec} 秒")
    print(f"{'=' * 70}")

    # 查询入库结果
    try:
        import pymysql
        conn = pymysql.connect(
            host=os.environ.get("MYSQL_HOST", "localhost"),
            port=int(os.environ.get("MYSQL_PORT", "3306")),
            user=os.environ.get("MYSQL_USER", "root"),
            password=os.environ.get("MYSQL_PASSWORD", "123456"),
            database=os.environ.get("MYSQL_DATABASE", "map_game"),
            charset="utf8mb4",
        )
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM pois")
            total = cur.fetchone()[0]
            cur.execute("SELECT COUNT(*) FROM pois WHERE cover_url IS NOT NULL")
            with_cover = cur.fetchone()[0]
            cur.execute("SELECT category, COUNT(*) FROM pois GROUP BY category ORDER BY COUNT(*) DESC")
            by_cat = cur.fetchall()
        conn.close()
        print(f"\n📊 数据库统计:")
        print(f"   POI 总数: {total}")
        print(f"   有封面图: {with_cover}")
        for cat, cnt in by_cat:
            print(f"   {cat}: {cnt}")
    except Exception as e:
        print(f"统计查询失败: {e}")


def main():
    parser = argparse.ArgumentParser(
        description="主题种子收集多进程启动器",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
  python -m scripts.run_theme_collect --workers 30
  python -m scripts.run_theme_collect --workers 30 --categories university_211,scenic_5a
  python -m scripts.run_theme_collect --workers 10 --categories unesco_whs
        """
    )
    parser.add_argument("--workers", type=int, default=30, help="并发进程数（默认 30）")
    parser.add_argument("--categories", type=str, default=None,
                        help="只收集指定主题（逗号分隔），默认全部")

    args = parser.parse_args()
    cats = args.categories.split(",") if args.categories else None
    run_parallel(args.workers, cats)


if __name__ == "__main__":
    main()
