#!/usr/bin/env python3
"""CLI for the built-in mvaigc reverse proxy.

Talks to the local proxy (default http://127.0.0.1:8787), which OSC starts
automatically. Zero third-party dependencies (urllib only).

Auth is `账号:密码`, taken from --auth or the MVAIGC_AUTH env var.

Usage:
  mvaigc-cli.py models
  mvaigc-cli.py image --prompt "一只猫" [--model gpt_image2]
  mvaigc-cli.py video --prompt "一只猫在跑" [--model minimax_h3] [--seconds 5]
  mvaigc-cli.py status <taskId>

Note: `image` / `video` spend account credits. `models` and `status` do not.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

DEFAULT_BASE = "http://127.0.0.1:8787"
POLL_INTERVAL_SECONDS = 2
POLL_TIMEOUT_SECONDS = 180


def request(base: str, auth: str, method: str, path: str, body: dict | None = None) -> dict:
    url = f"{base.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    headers = {"Authorization": f"Bearer {auth}"}
    if data is not None:
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")
        raise SystemExit(f"HTTP {error.code}: {detail}") from error
    except urllib.error.URLError as error:
        raise SystemExit(
            f"无法连接反代 {url}（{error.reason}）。OSC 是否已启动？"
        ) from error


def poll(base: str, auth: str, task_id: str) -> dict:
    deadline = time.monotonic() + POLL_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        result = request(base, auth, "GET", f"/v1/tasks/{task_id}")
        status = result.get("status")
        if status == "succeeded":
            return result
        if status == "failed":
            message = (result.get("error") or {}).get("message", "任务失败")
            raise SystemExit(f"任务失败: {message}")
        time.sleep(POLL_INTERVAL_SECONDS)
    raise SystemExit(f"轮询超时（>{POLL_TIMEOUT_SECONDS}s），任务号 {task_id}")


def resolve_auth(args: argparse.Namespace) -> str:
    auth = args.auth or os.environ.get("MVAIGC_AUTH", "")
    if ":" not in auth:
        raise SystemExit("需要凭据：--auth 账号:密码，或环境变量 MVAIGC_AUTH")
    return auth


def cmd_models(args: argparse.Namespace) -> None:
    auth = resolve_auth(args)
    result = request(args.base, auth, "GET", "/v1/models")
    for model in result.get("data", []):
        print(f"{model.get('id'):<28} {model.get('media', '')}")


def cmd_image(args: argparse.Namespace) -> None:
    auth = resolve_auth(args)
    body = {"model": args.model, "prompt": args.prompt, "n": 1}
    if args.size:
        body["size"] = args.size
    submitted = request(args.base, auth, "POST", "/v1/images/generations", body)
    task_id = submitted["id"]
    print(f"已提交: {task_id}")
    result = poll(args.base, auth, task_id)
    for item in result.get("output", []):
        print(item.get("url", ""))


def cmd_video(args: argparse.Namespace) -> None:
    auth = resolve_auth(args)
    body = {"model": args.model, "prompt": args.prompt, "seconds": args.seconds}
    if args.size:
        body["size"] = args.size
    submitted = request(args.base, auth, "POST", "/v1/videos", body)
    task_id = submitted["id"]
    print(f"已提交: {task_id}")
    result = poll(args.base, auth, task_id)
    for item in result.get("output", []):
        print(item.get("url", ""))


def cmd_status(args: argparse.Namespace) -> None:
    auth = resolve_auth(args)
    result = request(args.base, auth, "GET", f"/v1/tasks/{args.task_id}")
    print(json.dumps(result, ensure_ascii=False, indent=2))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="mvaigc 反代 CLI")
    parser.add_argument("--base", default=DEFAULT_BASE, help=f"反代地址（默认 {DEFAULT_BASE}）")
    parser.add_argument("--auth", default="", help="账号:密码（默认读 MVAIGC_AUTH）")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("models", help="列出模型（不消耗积分）").set_defaults(func=cmd_models)

    image = sub.add_parser("image", help="生成图片（消耗积分）")
    image.add_argument("--prompt", required=True)
    image.add_argument("--model", default="gpt_image2")
    image.add_argument("--size", default="")
    image.set_defaults(func=cmd_image)

    video = sub.add_parser("video", help="生成视频（消耗积分）")
    video.add_argument("--prompt", required=True)
    video.add_argument("--model", default="minimax_h3")
    video.add_argument("--seconds", type=int, default=5)
    video.add_argument("--size", default="")
    video.set_defaults(func=cmd_video)

    status = sub.add_parser("status", help="查询任务（不消耗积分）")
    status.add_argument("task_id")
    status.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    args.func(args)
    return 0


if __name__ == "__main__":
    sys.exit(main())
