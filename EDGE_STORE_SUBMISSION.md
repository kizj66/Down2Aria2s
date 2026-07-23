# Edge 商店上架提交清单（Down2Aria2s v2.0.0）

> 本文件把 Partner Center 里「Create new extension」8 步表单每个框该填什么都写好了。
> 你只需：登录 → 复制粘贴 → 上传 `Down2Aria2s-2.0.0.zip` → 点提交。
> **开发者注册免费，无注册费。**

---

## 前置准备（一次性）

1. 打开 👉 https://partner.microsoft.com/dashboard/home 用 **Microsoft 账号（MSA）** 登录。
   - 没有微软账号？用你已有的 **GitHub 账号** 直接登录 Partner Center，系统会自动帮你建一个 MSA。
2. 在左侧 Workspace 选 **Edge** 卡片 → 进入 Microsoft Edge 扩展开发者计划 → 填注册表（账户地区选中国、账户类型选「个人」、发布者显示名填 `Down2Aria2s`）。
3. 勾选同意 Microsoft Store 开发者协议 → Finish。
4. 个人账号验证较快（确认显示名可用即可）；等状态变「已验证」后再提交。

---

## 第 1 步：上传扩展包（.zip）

- 点 **Create new extension** → **Packages** → 把下面这个文件拖进去：
  - 本地路径：`D:\downloads\Down2Aria2s-2.0.0.zip`
  - 或 GitHub Release 下载：https://github.com/kizj66/Down2Aria2s/releases/download/v2.0.0/Down2Aria2s-2.0.0.zip
- 等待校验通过（MV3、manifest 在根目录，应一次过）→ 点 **Continue**。

## 第 2 步：Availability（可用性）

- **Visibility**：选 `Public`（所有人可搜索/浏览发现）。
- **Markets**：默认「所有市场」即可（含中国大陆）。如需限定，点 Change markets 自选。

## 第 3 步：Properties（属性）

| 字段 | 填什么 |
|---|---|
| Category（类别） | **Utilities（实用工具）** |
| Website（网站，选填） | https://github.com/kizj66/Down2Aria2s |
| Support contact（支持联系，选填） | 你的邮箱，或 https://github.com/kizj66/Down2Aria2s/issues |
| Mature content（成熟内容） | **不勾选** |

## 第 4 步：Privacy（隐私 / 2026 新独立页面）

| 区块 | 填什么 |
|---|---|
| 单一用途描述 | 把浏览器下载任务分发到用户自行配置的 Aria2 服务器，并监控各设备下载进度。 |
| 权限理由 | 见下方「权限理由表」 |
| 是否使用远程代码 | **否，我没有使用远程代码**（MV3 不允许远程托管代码） |
| 数据使用量 | 见下方「数据使用声明」 |
| 隐私政策 URL | https://github.com/kizj66/Down2Aria2s/blob/master/PRIVACY.md |

### 权限理由表（逐一填写）

| 权限 | 理由（直接复制） |
|---|---|
| `downloads` | 拦截浏览器下载事件，获取下载链接、文件名与大小，以便转发到 Aria2。 |
| `storage` | 保存用户配置的 Aria2 设备地址、端口与令牌等设置。 |
| `cookies` | 对部分需要登录鉴权的站点，读取 Cookie 以通过 Aria2 拉取受保护资源。 |
| `<all_urls>`（host_permissions） | 下载目标链接可能来自任意网站，需向其发起 Aria2 JSON-RPC 所需的网络请求。 |

### 数据使用声明（Data use）

- 收集的用户数据类型：**不收集任何个人数据**（仅在你主动发起下载时，把下载链接/文件名/大小经 Aria2 JSON-RPC 发往你自配的服务器；配置仅存本地 `chrome.storage`）。
- 勾选「我证明以上披露属实」。

## 第 5 步：Store listing（商店列表 — 每种语言）

- 先确认语言为 **中文(简体)**（manifest `default_locale=zh`）。
- 以下字段会自动从 manifest 读取（只读），无需手填：
  - **Display name**：`Down2Aria2s`
  - **Short description**（短描述）：`把下载任务一键分发到多台 Aria2 设备，并实时查看每台设备的下载进度。`
  - **Description**（描述）：`多设备 Aria2 下载分发器，支持在线检测和进度监控。`
- 若想在商店页展示更丰富的描述，可在本页「Description」框里覆盖写入下面这段（建议直接复制）：

```
Down2Aria2s 是一款多设备 Aria2 下载分发器 Chrome / Edge 扩展。

【核心功能】
- 多设备管理：集中维护多台 Aria2 服务器（NAS、本机、远端等），显示在线/离线状态。
- 一键分发：在浏览器下载确认弹窗中，勾选目标设备即可把任务下发到对应 Aria2。
- 进度监控：弹窗内实时显示每台设备的下载进度、速度与剩余时间。
- 确定性强：取消任务会实际校验 Aria2 后台是否已停止，避免「前台删了后台还在下」。

【隐私】
不收集任何个人数据。设备配置仅存于浏览器本地，下载信息仅在你主动发起时发往你自配的 Aria2 服务器。
```

- **Search terms（搜索词）**：`aria2, 下载, 离线下载, NAS, 下载工具, 多设备`
- **Screenshots（截图）**：上传仓库里的
  - `screenshot/1.png`（弹窗：下载任务 + 设备管理）
  - `screenshot/2.png`（confirm 弹窗）
  - `screenshot/promo-1280x800.png`（宣传图 1280×800，推荐首图）
- （可选）**YouTube 视频**：留空。

## 第 6 步：提交（Testing notes）

在「Certification notes」框里写：

```
本扩展为 Manifest V3 多设备 Aria2 下载分发器。
- 测试方式：在 Edge 加载已解压扩展，配置一台 Aria2 服务器（含 ws/rpc 地址与可选 token），
  从任意页面触发下载，在 confirm 弹窗勾选设备下发；弹窗与扩展页均能实时显示各设备进度。
- 无远程代码、无遥测、不收集个人数据；隐私政策见仓库 PRIVACY.md。
- 权限均用于下载转发与本地配置存储，已在隐私页逐条说明。
```

点 **Submit** → 进入审核（通常 1–7 个工作日）。审核通过即上架。

---

## 所需素材本地路径

| 素材 | 路径 |
|---|---|
| 提交用 zip 包 | `D:\downloads\Down2Aria2s-2.0.0.zip` |
| 图标 128×128 | `public/images/128.png`（已含，无需另传） |
| 弹窗截图 | `screenshot/1.png`、`screenshot/2.png` |
| 宣传图 1280×800 | `screenshot/promo-1280x800.png` |
| 隐私政策 | `PRIVACY.md`（已发布到 GitHub，URL 见上） |

> 注意：本扩展当前 `default_locale=zh`，商店列表默认中文。如需英文列表，在 Partner Center 本页「添加语言」选 English (en)，把上面中文文案翻译成英文再填一遍即可。
