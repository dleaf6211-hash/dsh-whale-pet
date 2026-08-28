#!/usr/bin/env bash
# 鲸鱼娘桌宠 — 首次推送脚本（在 Git Bash 中运行）
# 用法: cd /e/dsh-workspace/whale-repo && bash push-everything.sh
set -e

git init -b main 2>/dev/null || true
git config user.name "dleaf6211-hash"
git config user.email "dleaf6211@gmail.com"

# 分 10 个小提交(市场收录要求仓库 ≥10 次提交)
git add cordis.patch.yml package.json .gitignore
git commit -m "chore: package manifest and cordis bundle patch" || true

git add lib/index.js
git commit -m "feat: host entry with routes, balance fetch and desktop pet launcher" || true

git add client/client.js
git commit -m "feat: browser client with board, pat interaction and idle speech" || true

git add assets/skins
git commit -m "assets: whale girl skins (board pose, shy sticker)" || true

git add assets/voices/manifest.json assets/voices/line-00.wav assets/voices/line-01.wav assets/voices/line-02.wav assets/voices/line-03.wav assets/voices/line-04.wav
git commit -m "assets: idle voice lines 0-4" || true

git add assets/voices/line-05.wav assets/voices/line-06.wav assets/voices/line-07.wav assets/voices/line-08.wav assets/voices/line-09.wav
git commit -m "assets: idle voice lines 5-9" || true

git add assets/voices/line-10.wav assets/voices/line-11.wav assets/voices/line-12.wav assets/voices/line-13.wav
git commit -m "assets: idle voice lines 10-13" || true

git add assets/voices/line-14.wav assets/voices/line-15.wav assets/voices/line-16.wav assets/voices/line-17.wav assets/voices/line-18.wav
git commit -m "assets: pat voice lines 14-18" || true

git add assets/voices/notice-*.wav
git commit -m "assets: task notice voices" || true

git add test scripts assets/screenshots screenshots.json
git commit -m "test: host smoke, desktop pet e2e, render harness and screenshots" || true

git add README.md LICENSE market-entry
git commit -m "docs: readme, license and market entry" || true

echo ""
echo "=== 提交完成,共 $(git rev-list --count HEAD) 个提交 ==="
echo "下一步:在 Git Bash 里执行"
echo "  git remote add origin https://github.com/dleaf6211-hash/dsh-whale-pet.git"
echo "  git push -u origin main"
echo "用户名填 dleaf6211-hash,密码处粘贴你的 Personal Access Token"
