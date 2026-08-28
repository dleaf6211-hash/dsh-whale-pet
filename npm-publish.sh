#!/usr/bin/env bash
# npm 发布脚本(在 Git Bash 中运行)
# 前置:已在浏览器登录过 npm 账号?没有的话 npm login 会交互式要求账号密码/邮箱
set -e
NPM="/c/Users/ABC/.workbuddy/binaries/node/versions/22.22.2/npm.cmd"
NODE="/c/Users/ABC/.workbuddy/binaries/node/versions/22.22.2/node.exe"

cd /e/dsh-workspace/whale-repo

echo "=== 检查包内容(dry-run)==="
"$NPM" pack --dry-run 2>&1 | tail -n 40

echo ""
echo "=== 登录 npm(如已登录可跳过;登录一次即可)==="
"$NPM" login

echo ""
echo "=== 发布 ==="
"$NPM" publish

echo ""
echo "=== 完成!验证: npm view dsh-whale-pet ==="
