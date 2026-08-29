#!/usr/bin/env bash
# 市场收录 PR 提交脚本(在 Git Bash 中运行)
# 前置:
#   1. 浏览器打开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin 点 Fork(叉到你自己的账号)
#   2. 仓库满 24 小时(8-29 17:47 北京时间之后)再跑本脚本
set -e

WORK=/e/dsh-workspace/awesome-fork
rm -rf "$WORK"
mkdir -p "$WORK"
cd "$WORK"

echo "=== 前置检查:你的 fork 是否已存在(不存在会 clone 失败)==="
FORkURL="https://github.com/dleaf6211-hash/awesome-dsh-plugin.git"
HTTPCODE=$(curl -s -o /dev/null -w "%{http_code}" https://github.com/dleaf6211-hash/awesome-dsh-plugin)
if [ "$HTTPCODE" != "200" ]; then
  echo ""
  echo "❌ 还没 Fork! 请先在浏览器打开下面链接点右上角 Fork:"
  echo "   https://github.com/awesome-dsh-plugin/awesome-dsh-plugin"
  echo "   Fork 完成后再重新运行本脚本"
  exit 1
fi

echo "=== 克隆你的 fork ==="
git clone "$FORkURL" .
git remote add upstream https://github.com/awesome-dsh-plugin/awesome-dsh-plugin.git

echo "=== 同步上游最新(避免 fork 落后导致 PR 冲突)==="
git fetch upstream
git checkout main
git merge --ff-only upstream/main

echo "=== 建分支 ==="
git checkout -b add-dsh-whale-pet

echo "=== 复制收录条目 ==="
cp /e/dsh-workspace/whale-repo/market-entry/dleaf6211-hash__dsh-whale-pet.yml data/plugins/dleaf6211-hash__dsh-whale-pet.yml

echo "=== 重新生成两个 README(用你机器上的 node/npm)==="
NODE="/c/Users/ABC/.workbuddy/binaries/node/versions/22.22.2/node.exe"
NPM="/c/Users/ABC/.workbuddy/binaries/node/versions/22.22.2/npm.cmd"
"$NPM" ci
"$NODE" scripts/generate-readme.mjs

echo "=== 提交 ==="
git config user.name "dleaf6211-hash"
git config user.email "dleaf6211@gmail.com"
git add data/plugins/dleaf6211-hash__dsh-whale-pet.yml README.md README.zh.md
git commit -m "Add dsh-whale-pet"

echo "=== 推送到你的 fork(密码处粘贴 PAT)==="
git push -u origin add-dsh-whale-pet

echo ""
echo "=== 完成! 现在打开浏览器发起 PR:"
echo "  https://github.com/dleaf6211-hash/awesome-dsh-plugin/pull/new/add-dsh-whale-pet"
echo "  标题: Add dsh-whale-pet"
