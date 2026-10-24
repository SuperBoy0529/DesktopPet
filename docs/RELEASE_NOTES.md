# Release 文案（v1.0.0）

> 直接复制下面「发布标题」和「发布说明」两段到 GitHub Release 表单即可。

---

## 发布标题

```
v1.0.0 · 世界线变动率探测仪
```

备选（想更带梗一点）：

```
v1.0.0 · El Psy Kongroo
```

```
v1.0.0 · 世界线变动率探测仪（纯 CSS 外观 · 不含游戏素材）
```

---

## 发布说明

```markdown
《命运石之门》主题的 Windows 桌面宠物：8 位辉光管、时间与世界线双模式、17 条特殊世界线。

> 本版本默认外观为**纯 CSS 绘制**，仓库与安装包**不含任何游戏美术素材**。
> 想换成自己的素材见下方「外观与素材」。

## 📦 下载

**WorldlineDivergenceMeter-Setup.exe** · 109.8 MB

- 系统：Windows 10 / 11 x64
- 按用户安装，**不需要管理员权限**（装到 `%LOCALAPPDATA%\Programs\WorldlineDivergenceMeter`）
- 开始菜单与桌面会创建快捷方式，附带 README
- 卸载：设置 → 应用 → 卸载，或安装目录里的 `uninstall.exe`
- 升级不会覆盖你改过的 `config.json` / `texts.json`
- 安装目录内含 `image\` 与 `tools\prepare-assets.ps1`，用于替换成自己的美术素材

**SHA256**
```
38AB035FF800290CC8421BB28D9E2D826DDA3AE9FCFD2BAAE9C6D1A31977E97E
```

## ✨ 功能

- **8 位辉光管**，时间模式 `HH:MM:SS`，世界线模式 `d.dddddd`
- **17 条特殊世界线**：Steins;Gate、红莉栖 END、真由理 END、菲利斯线……各带台词与章节
- **点击漂移**：三档位移，连续点击才明显；特殊世界线有保底计数
- **右键菜单**：模式切换、5 种背景材质、点击穿透、隐藏、退出
- **点击穿透有四条退路**（状态条常驻提示 / 角落恢复把手 / `Ctrl+Alt+Shift+D` / 托盘），不会把自己锁死
- 位置记忆、单实例、无边框透明、始终置顶
- 配置与文案分离：行为在 `config.json`，所有文字在 `texts.json`

## 🎨 外观与素材

默认是**纯 CSS 绘制**的数码管（渐变灯管 + 栅格网 + 字体辉光），克隆/安装即可运行，不依赖任何图片。

想换成自己的素材：

1. 把图放进 `image/`（`0.png`…`9.png`、`empty.png`、`dot.png`、`croix.png`、`fond.png`）
2. 运行 `powershell -ExecutionPolicy Bypass -File tools\prepare-assets.ps1`
3. 下次启动自动切换为图片管体

文件名清单与说明见 README 的「外观与素材」一节。

## ⚠️ 已知问题

- **未签名**：首次运行会弹 SmartScreen「Windows 已保护你的电脑」，点「更多信息 → 仍要运行」即可。
- **部分机器上系统托盘不显示图标**（程序会写日志）。为此内置了兜底：隐藏窗口后若检测到托盘不可见，会在 15 秒后自动把窗口放回。
- exe 的图标与版本信息仍是 Electron 自带的，换成自定义图标需要 `rcedit`。

## 🧪 测试

- 21 项逻辑断言（`node test\acceptance.js`）
- 24 项集成断言（`node test\integration.js`）——会真实发送系统快捷键、读取窗口扩展样式，验证穿透与恢复

全部通过。

## 📄 版权

本项目是**非官方粉丝作品**，与 MAGES. / 5pb. / Nitroplus 没有任何隶属关系。
仓库不含任何第三方美术素材；角色与相关标识归其各自权利方所有。
代码以 MIT 发布，第三方素材不在 MIT 范围内。详见 [NOTICE.md](../NOTICE.md)。
```

---

## 发布表单怎么填

| 字段 | 填什么 |
|---|---|
| **Choose a tag** | 输入 `v1.0.0` → 点「Create new tag: v1.0.0 on publish」 |
| **Target** | `main` |
| **Release title** | 上面的「发布标题」 |
| **Describe this release** | 上面的「发布说明」 |
| ✅ **Set as the latest release** | 勾上 |
| **Attach binaries** | 拖入 `dist\WorldlineDivergenceMeter-Setup.exe` |

> 如果想让文件名带版本号，可以先把文件复制成
> `WorldlineDivergenceMeter-Setup-v1.0.0.exe` 再上传——**只改名不改内容，SHA256 不变**，上面那串校验值依然有效。

## 发布后自查

- [ ] Release 页能看到 109.8 MB 的 exe，且能下载
- [ ] 下载后 `Get-FileHash` 与上面的 SHA256 一致
- [ ] 仓库文件树里没有 `image/`、`src/assets/`（`git ls-files | findstr /i "image src/assets"` 无输出）
- [ ] B 站视频简介里的仓库链接可点、指向 Release
