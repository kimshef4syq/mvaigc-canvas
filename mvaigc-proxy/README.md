# mvaigc 反代 CLI

这是内置在 OSC（Open Storyboard Canvas）里的 mvaigc 反代的**命令行测试工具**。
反代本身由 OSC 在启动时自动运行（`127.0.0.1:8787`），本脚本只用于脱离画布手工验证。

## 前置

1. 启动 OSC（反代会自动监听本地端口）。
2. 在 OSC 设置 →「融媒视界 mvaigc」填账号密码并保存。

## 用法

凭据用 `账号:密码`，通过 `--auth` 或环境变量 `MVAIGC_AUTH` 传入。

```bash
# 列出模型（不消耗积分）
MVAIGC_AUTH='<账号>:<密码>' python3 mvaigc-cli.py models

# 生成图片（消耗积分）
MVAIGC_AUTH='<账号>:<密码>' python3 mvaigc-cli.py image --prompt "一只猫" --model gpt_image2

# 生成视频（消耗积分）
MVAIGC_AUTH='<账号>:<密码>' python3 mvaigc-cli.py video --prompt "一只猫在跑" --seconds 5

# 查询任务（不消耗积分）
MVAIGC_AUTH='<账号>:<密码>' python3 mvaigc-cli.py status imgToImage.12345
```

自定义反代地址：`--base http://127.0.0.1:9000`。

## 说明

- 零第三方依赖，仅用 Python 标准库。
- `image` / `video` 会**消耗账号积分**；`models` / `status` 不会。
- 反代不改 mvaigc 鉴权、不绕过校验，只是把"人手点页面"换成"程序发请求"。
