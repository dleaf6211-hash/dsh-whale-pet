# dsh-whale-pet

鲸鱼娘桌宠，为 DeepSeek Harness 而生：浏览器右下角的悬浮鲸鱼娘 + Windows 桌面置顶桌宠，双形态共享同一份数据。

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

## 功能

- **余额看板**：显示 DeepSeek 账户实时余额、当前会话消耗、本月消耗，可一键刷新
- **任务通知**：任务完成/失败/等待审批时，木牌弹出提示并语音播报
- **摸头互动**：鼠标停在鲸鱼娘头部，弹出害羞表情贴纸 + 爱心 + 台词
- **19 句带情感的台词**：随机台词与摸头台词各配专属语气，预合成语音随包分发，离线可用
- **陪伴节奏**：干活时 30 秒、空闲但人在电脑前 50 秒、人离开 120 秒检查一次，未触发则概率递增
- **桌面桌宠**：Windows 置顶 WPF 小窗（趴桌立绘 + 木牌卡片），与浏览器桌宠同步台词与通知
- **低余额提醒**：余额低于 5 元时木牌弹出提醒，提供充值入口与官方充值地址指引（默认展示文字指引，二维码需自配生成服务）

## 安装

```sh
dsh plugin add github:dleaf6211-hash/dsh-whale-pet
# 或
dsh plugin --profile web add dsh-whale-pet-plugin
```

安装后重启 Harness（或对应 profile）即可看到浏览器右下角的鲸鱼娘。桌面桌宠自动拉起；可在设置中关闭。

## 数据与隐私

- 余额查询使用你本机 `~/.dsh/.credentials.yaml` 中的 DeepSeek API Key，请求直连 `api.deepseek.com`，不经过任何第三方
- 台词语音全部为仓库内置的预合成音频，运行时不调用任何 TTS 服务
- 除余额查询外，插件不发起任何网络请求，所有状态只保存在本机 `~/.whale-pet/`

## 系统要求

- Windows（桌面桌宠基于 PowerShell WPF；浏览器桌宠在任何系统可用）
- DeepSeek Harness（dsh）

## 截图

见仓库 `screenshots.json`。

## License

MIT
