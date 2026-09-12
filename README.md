# 🎧 影子100 —— 英语影子跟读练习APP

> 影子跟读100遍，熟读成诵。零依赖、纯本地、离线可用的英语跟读训练工具。

**影子100**（原「影子练习」）是一款专为英语影子跟读（Shadowing）设计的安卓APP：导入自己的英语音频/文本，逐句跟读录音，自动累计练习时长与连续打卡天数。所有数据存在手机本地（IndexedDB），不上传任何服务器。

## ✨ 核心功能

- 📂 **导入自定义内容** —— 支持音频 + 文本，按文件夹/课程分类管理
- 🎧 **逐句精听** —— 自动切句，单句循环，慢速/常速切换
- 🎙️ **跟读录音** —— 边听边录，回放对比原声，找出差距
- 📊 **练习统计** —— 总坚持天数、连续打卡天数、累计练习时长（按录音时长累计）、最近28天打卡热力条
- 💾 **数据导出** —— 一键备份/恢复全部数据（ZIP存到 Download/影子100/）
- 🔒 **纯本地离线** —— 无账号、无登录、无网络权限需求，数据100%留在手机

## 📱 安装

**方式一：直接下载APK**（推荐）

到 [Releases](../../releases) 页面下载最新 `影子100-vX.X.apk`，手机上直接安装即可。

**方式二：自己编译**

```bash
git clone https://github.com/yesaiwen2008/shadow-100.git
cd shadow-100
# 需先安装 Android SDK、Node.js
cd android && ./gradlew assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

> ⚠️ **老用户升级提示**：从旧版「影子练习」升级请直接**覆盖安装**（不要卸载），练习数据会完整保留。

## 🗂️ 目录结构

```
├── index.html          # 主页面（单页应用）
├── js/app.js           # 业务逻辑
├── js/db.js            # IndexedDB 封装
├── css/style.css       # 样式
├── capacitor.config.json
└── android/            # Capacitor 安卓工程
    └── app/src/main/
        ├── java/com/shadow/english/   # MainActivity + NativeUtils原生插件
        ├── assets/public/             # 打包进APK的Web资源（与根目录同步）
        └── res/                       # 图标、strings.xml
```

## 🏗️ 技术栈

- **前端**：原生 HTML/CSS/JS + IndexedDB（零框架零依赖）
- **壳**：Capacitor 8（WebView）
- **原生层**：MediaRecorder录音（Web）+ NativeUtils插件（Java，负责把导出文件写入 Download/影子100/）
- **数据**：全部存 IndexedDB，ZIP备份导出

## 📊 统计口径说明

| 指标 | 口径 |
|------|------|
| 总共坚持天数 | 有录音记录的不同自然日数 |
| 连续练习天数 | 截至今天的连续打卡天数（今天还没练则从昨天往前算，不断链） |
| 累计练习时长 | 每次录音的 duration 逐条累加（秒） |

## 📜 更新日志

- **v3.20（2026-09-13）**：更名为「影子100」；导出目录同步更名 Download/影子100/
- **v3.19（2026-09-13）**：新增📊练习统计页（坚持天数/连续天数/累计时长/28天打卡条）
- **v3.18（2026-09-12）**：录音截断修复（屏幕常亮+2秒收尾缓冲+手动停止+兜底保存）
- 更早版本：音频导入、逐句精听、跟读录音、ZIP备份/恢复

## 📄 License

MIT
