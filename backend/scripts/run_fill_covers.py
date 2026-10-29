#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
POI 封面补齐多进程启动器（高德检索真实照片 → OSS）

用法：
    cd backend
    python3 -m scripts.run_fill_covers --workers 30
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

SCRIPTS_DIR = Path(__file__).parent
WORKER_SCRIPT = SCRIPTS_DIR / "fill_covers_worker.py"


def read_process_output(proc, partition, progress_dict, lock):
    progress_pattern = re.compile(r'PROGRESS (\d+)/(\d+)')
    for line in proc.stdout:
        line = line.strip()
        if not line:
            continue
        m = progress_pattern.search(line)
        if m:
            with lock:
                progress_dict[partition] = {
                    'processed': int(m.group(1)),
                    'total': int(m.group(2)),
                }


def run_parallel(workers):
    print(f"🚀 启动 {workers} 进程并行补齐封面")
    print("=" * 70)

    processes = []
    progress_dict = {}
    lock = threading.Lock()

    def kill_all_children(signum=None, frame=None):
        for p in processes:
            if p.poll() is None:
                try:
                    p.terminate()
                except Exception:
                    pass
        sys.exit(1)

    signal.signal(signal.SIGINT, kill_all_children)
    signal.signal(signal.SIGTERM, kill_all_children)

    for i in range(workers):
        cmd = [sys.executable, str(WORKER_SCRIPT),
               "--partition", str(i), "--partition-total", str(workers)]
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                bufsize=1, universal_newlines=True, env=env)
        processes.append(proc)
        t = threading.Thread(target=read_process_output,
                             args=(proc, i, progress_dict, lock))
        t.daemon = True
        t.start()

    start_time = time.time()
    while sum(1 for p in processes if p.poll() is not None) < workers:
        elapsed = int(time.time() - start_time)
        with lock:
            done = sum(p.get('processed', 0) for p in progress_dict.values())
            total = sum(p.get('total', 0) for p in progress_dict.values())
        pct = (done / total * 100) if total else 0
        print(f"\r⏱️ {elapsed}s | 进度 {done}/{total} ({pct:.1f}%)", end="", flush=True)
        time.sleep(3)
    print()

    ok = sum(1 for p in processes if p.returncode == 0)
    print(f"✅ 完成: {ok}/{workers} 进程成功, 耗时 {int(time.time() - start_time)}s")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=30)
    args = parser.parse_args()
    run_parallel(args.workers)


if __name__ == "__main__":
    main()
