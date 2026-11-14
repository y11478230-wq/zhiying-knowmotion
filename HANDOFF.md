# 知映项目移交说明

> 网站原型：知映 2.4.0；Android：2.4.0（versionCode 19）
> 目标：把项目交给另一位开发者或另一台 Windows 笔记本后，能独立安装、启动、演示网站，并继续优化网站与生成视频的视觉质量。

## 一、项目是什么

知映面向普通创作者：输入一个知识问题，AI 生成可编辑的教学分镜和旁白；创作者可调整镜头、术语读法、画面元素与配音，再预览并导出 MP4。分镜与文字稿由 DeepSeek API 生成，画面由本地 Canvas 模板实时绘制，默认由运行后端的 Windows 电脑使用 System.Speech 离线合成配音，也可选在线中文语音。

当前项目不包含内置知识库、图片／视频生成模型或音色复刻。`.env`、API 密钥与 APK 均不应该随源码包发送。

### 2.2.0 创意到视频工作台（2.2.1 接口兼容修复）

新建创作会先请求 `/api/creative` 生成三个讲解方向；选定后使用原 `/api/generate` 生成分镜。导演方案可单幕编辑、增删复制排序与锁定；`/api/scene/revise` 返回单幕修改候选，用户确认后才保存。独立视频工作台支持按镜头预览、修改与版本恢复。2.2.1 在新接口遇到旧后端 404 时自动尝试 4174 并记住新版后端地址。Android 版本号为 2.2.1，versionCode 为 16，可覆盖此前版本；必须保留同一台电脑原有的 Android debug.keystore 才能升级安装。

### 2.3.0 初高中长视频课堂（2.3.1 合成链路优化）

首页增加独立「长视频课堂」入口，提供初中/高中年级、学科、主题、讲解模式与 3/5/8 分钟设置。`POST /api/long-video/plan` 先生成 3/5/8 章大纲；用户可编辑标题、目标和章节范围；`POST /api/long-video/chapter` 每次生成一章的 4 幕教学分镜，章节结果逐章写入本机草稿，异常后可以续跑。全部完成后项目进入原有导演方案工作台，继续本地保存、配音、预览和导出。长视频 MP4 使用较低录制码率控制文件大小；语音按最多 3 并发准备。Android 版本为 2.3.0，versionCode 17。

2.3.1 将章节分镜改为最多两章并行生成，按章节位置保存结果；单章失败时保留其他成功章节，续跑只请求缺失章节。章节生成完即把旁白放入最多两路的本机配音队列，与后续章节生成重叠进行。草稿从 2.3.0 的顺序结构自动迁移，语音缓存提高到 48 条、32 MB。长视频最终 MP4 仍由现有浏览器实时录制链路生成，导出等待时间与视频播放时长大致相同。

### 2.1.0 灵感、作品库、我的

第三阶段新增 `community.js` 与 `community.css`，沿用首页四入口导航和原有 `app.js` 项目数据。AI 分镜生成完成后仍是草稿；只有成功导出并在 IndexedDB 保存 MP4 的项目才是“已完成”，可以从作品库发布。灵感的两条静音示例视频在 `examples/demo-*.mp4`，均标为演示内容。社区发布、收藏、点赞、评论、关注和下载请求单独存入 `zhiying-community-v1`，不与作品库混排；视频 Blob 存入 `zhiying-media-v1`。数据模型、范围与验收记录详见 [第三阶段实现说明](PHASE3-IMPLEMENTATION.md)。

### 2.1.1 配音随之就绪

生成分镜或载入示例后，前端自动逐幕预取配音并缓存，不再需要先点播放；配音进度、录制进度与转码状态统一显示在预览播放器下方，顶部消息条只保留操作提示和错误。切换音色或语速会按新参数重新预取，切换项目会取消进行中的预取。Android 2.1.1（versionCode 14）与网站同源，更新后即可看到该行为。


### 2.0.5 首页创作输入

首页沿用原有创作设置与 `/api/generate` 工作流。`app.js` 的「AI 优化」调用新增 `/api/optimize`，仍使用已配置的 `deepseek-flash`；仅更新输入文字，保留恢复原文入口。`/api/reference/parse` 验证文件并提取资料，提交时将提取正文或图片数据送进原有 `/api/generate`。资料文件名只用于本机展示和作品元信息，不作为知识内容。图片由 DeepSeek 视觉输入读取；TXT/Markdown、PDF、DOCX 由 `scripts/parse-reference.py` 解析，PDF 依赖 `pypdf`，DOCX 使用 Python 标准库。最多 4 份，图片每张 2 MB、文档每份 5 MB；PDF 最多前 30 页，单份文档正文最多前 6000 字。扫描版或加密 PDF、旧 `.doc` 不支持。后端优先使用项目 `.venv` 中的 Python，否则使用 PATH 中的 Python；安装依赖见下文。

## 二、另一台 Windows 笔记本启动网站

### 需要的软件

- Windows 10/11 x64
- Node.js 24 或更高版本（npm 随 Node.js 安装）
- Python 3.10 或更高版本
- FFmpeg，并确认 `ffmpeg.exe` 已加入 PATH
- Chrome 或 Edge
- DeepSeek API Key：仅调用 AI 生成分镜时需要；本地 C 语言示例无需 API Key

### 从源码包启动

1. 解压 `知映-源码移交.zip` 到一个普通英文或中文路径，例如 `D:\zhiying`。
2. 在项目根目录复制环境变量模板：

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   把 `DEEPSEEK_API_KEY=your_key_here` 替换为自己的密钥。`HOST` 默认只监听本机；仅在受控局域网或经过反向代理配置后才改。不要把真实密钥提交到 Git、发到群聊或打进 APK。

3. 安装 Node 依赖：

   ```powershell
   npm ci
   ```

4. 安装 Python 配音依赖：

   ```powershell
   python -m venv .venv
   .\.venv\Scripts\python.exe -m pip install -r requirements.txt
   ```

5. 确认 FFmpeg 可用，然后启动：

   ```powershell
   ffmpeg -version
   npm start
   ```

6. 浏览器打开 `http://localhost:4173`。若端口冲突，在 `.env` 写 `PORT=4174`，再访问对应端口。

首次演示可按「C 语言示例」，不需要配置 API Key。AI 生成与在线神经配音需要网络/API；本机离线配音由 Windows 后端合成，MP4 导出需要 FFmpeg。当前后端默认监听 `127.0.0.1`。手机本地联调推荐 USB + ADB 端口转发；同一可信 Wi-Fi 才将 `HOST` 设为 `0.0.0.0` 并配置防火墙。跨源前端还需在 `ALLOWED_ORIGINS` 填完整来源（例如 `https://studio.example.com`）。当前限流存在进程内，适合原型；公网服务仍须通过反向代理加 HTTPS、鉴权和集中限流，不能仅依赖 CORS 或单机限流。

## 三、重要文件地图

| 文件 | 用途 |
| --- | --- |
| `index.html` | 页面结构、知识问题输入、目标观众／讲解方式、配音控制、分镜编辑器、预览区 |
| `styles.css` | 网站基础布局与组件样式（深色基底的原始主题） |
| `light.css` | 当前浅色主题、响应式布局、轻动效；后加载并覆盖基础主题 |
| `app.js` | 前端状态、AI 请求、分镜编辑与本地保存、配音、播放、Canvas 录制、MP4 导出 |
| `renderer.js` | 1280×720 Canvas 视频绘制；七种镜头模板、字幕、进度与入场动画 |
| `server.mjs` | Node 本地 HTTP 服务；DeepSeek、配音、FFmpeg 转码 API 与静态资源白名单 |
| `tts.py` | `edge-tts` 在线中文语音调用 |
| `requirements.txt` | Python 在线配音依赖 |
| `package.json` / `package-lock.json` | Node 脚本、Capacitor 依赖及可复现安装锁文件 |
| `manifest.webmanifest` / `sw.js` / `icon.svg` | PWA 安装信息、离线页面外壳与图标 |
| `scripts/copy-mobile.mjs` / `capacitor.config.json` | 可选 Android Web 资源复制与 Capacitor 配置 |
| `scripts/publish-apk.mjs` / `ANDROID-REMOTE-UPDATE.md` | 发布版本清单与 APK，及 Android 本机远程升级流程 |
| `native-patches/app/src/main/java/com/zhiying/education/AppUpdaterPlugin.java` | Android 原生升级下载、SHA-256 校验和调起系统安装器 |
| `examples/c-hello-world-script.md` / `examples/c-voice-sample.mp3` | C 语言演示内容与样音 |
| `.env.example` | 环境变量格式示例，不含密钥 |

## 四、主要数据流

1. `app.js` 向 `POST /api/generate` 发送主题、观众、讲解方式和目标时长（30／60／90 秒）。
2. `server.mjs` 用 `systemPrompt` 约束 DeepSeek 输出 JSON 分镜，并通过 `normalizeProject` 限制字段与长度。
3. 前端可逐幕改旁白、标题、模板、代码、命令、关键词与时长；项目、历史索引和作品库保存在当前浏览器 `localStorage`，支持搜索、恢复、重命名和删除。
4. 生成分镜或载入示例后，前端会自动逐幕预取 `POST /api/speech` 并缓存音频，进度显示在预览播放器下方；播放／导出时只补取缺失的幕，画面由 `renderer.js` 绘制。
5. 浏览器先录成 WebM，再把文件发给 `POST /api/convert`；服务端调用 FFmpeg 转成 MP4。

### 后端运行保护（当前版本）

- JSON 请求限制为 64 KiB；WebM 上传默认限制为 80 MiB，并检查 WebM 文件头。
- AI 生成、配音与转码分别限制并发任务数；按来源 IP 对三类计算接口做进程内频率限制。
- AI 请求 65 秒超时；在线／本机配音和 FFmpeg 转码均有超时；上传 30 秒无数据即中断。
- 配音结果使用带容量和有效期上限的内存缓存；缓存不会写到磁盘；命中缓存不消耗频率配额。
- API 错误按客户端输入、服务忙、上游失败与超时返回状态码，未处理的内部异常对客户端隐藏。
- 配音、分镜生成、视频转码和 APK 下载均使用独立并发上限与有界等待队列；排队超过上限会返回 503 和 `Retry-After`，不会无限挂起。配音支持前端分幕进度和短期音频缓存，降低重复试听等待。
- `/api/status` 每次按 2 分钟缓存真实探测 FFmpeg、`edge-tts`、`pypdf`、System.Speech 和前端依赖，返回 `export.ffmpeg`、`speech.windows`、`speech.neural`、`reference.pypdf`、`jobs` 等字段；缺依赖时首页显示“部分能力不可用”并禁用导出，不会误报可用。
- 缺少 FFmpeg 时 `/api/convert` 在接收视频前直接返回 503，不会先上传整段视频再失败。
- WebM 上传直接流式写入临时文件、转换后以流回传，内存占用不随视频体积增长；服务退出时回收 FFmpeg、PowerShell 和 Python 子进程。
- 静态资源支持 ETag/304 与 gzip（文本资源约压缩到 1/3），API 保持 `no-store`；响应带 CSP、`X-Frame-Options`、`Permissions-Policy` 等安全头。
- 同源本机开发开箱即用；跨域浏览器来源由 `ALLOWED_ORIGINS` 精确控制。默认仅监听 `127.0.0.1`；改为 `0.0.0.0` 时启动日志会告警，`/api/status` 返回 `exposed: true`，前端在服务详情中提示“接口没有鉴权”。
- 限流仅存在单机内存中，没有用户身份鉴权；公网发布前必须补 HTTPS、鉴权、集中限流和日志监控。

## 五、交接后优先优化的视觉方向

### 网站风格

当前已有浅色背景、薄荷绿与柔和蓝色、响应式布局和轻量动效。下一步应统一成清爽的“知识创作工作台”：先突出一个清晰的输入与生成入口；再拉开「内容输入／分镜编辑／成片预览」的层级；统一圆角、边框、阴影、间距、按钮与表单状态；移动端让输入、生成与预览操作更直接。动效服务于操作反馈，减少装饰性闪光与无意义悬浮。改版入口主要是 `light.css` 与 `index.html`，保持对比度、键盘焦点、窄屏可用性。

### 视频画面与生成风格

目前 `renderer.js` 已有悬念开场、对比、步骤、原理图、代码、终端、总结七种模板，但主要是通用卡片和轻网格背景。后续应让“像一条剪辑完成的教学视频”成为目标，而非只把文字放进卡片：

- 叙事节奏采用「先抛现象／问题 → 展示具体证据或操作 → 拆解原理 → 回到结论／小练习」。
- 每幕只保留一个视觉重点；根据概念选择图解、步骤、代码编辑器、终端或对比镜头，避免非编程主题误用代码画面。
- 代码和终端镜头要跟旁白逐步揭示，突出当前解释行；命令、代码和输出必须互相匹配，不捏造运行结果。
- 字幕保持高对比度、句意完整、每次一到两行；下一阶段可接入语音时间戳，替换现有按字数估算的字幕节奏。
- 用有节制的镜头转场、重点标注、局部高亮和构图变化建立节奏；图形动作必须解释知识关系，不只是背景装饰。
- AI 分镜提示词位于 `server.mjs` 的 `systemPrompt`；画面模板位于 `renderer.js`。提示词决定“讲什么／怎么讲”，绘制器决定“镜头如何呈现”，修改时应两处联动。
- 增加知识正确性复核提示、旁白与屏幕内容一致性检查，以及导出前的字幕／时长预览；不把 AI 初稿包装成已核验的教学结论。

建议每次只改一类：先定网站视觉规范，再做一组代表性视频模板，使用 C 语言样片和一个非编程知识点各自预览；确认专业主题与普通主题都合适后，再扩展模板。

### 2.0 已落地内容

- 采用产品设计图中的薄荷绿浅色视觉和移动端优先布局：创作首页、创作设置、生成状态、分镜工坊、灵感占位页、作品库、本机个人页与历史抽屉。
- 首页目标时长支持 30／60／90 秒，并传给后端提示词；模型仍负责实际分镜，界面不虚构进度百分比。
- 本机作品库支持继续编辑、重命名、删除；历史支持搜索、恢复、移除历史项及单独清空历史。
- 资料解析、账号云同步和社区仍未接入；页面明确显示状态，没有模拟成功态或虚构内容。

### 2.0.1 调整

- 首页隐藏次要入口、推荐列表和底部导航；保留主题输入、生成按钮、创作设置、历史与作品库入口，并调整小屏布局。
- Windows 离线配音将中文文本以 UTF-8 编码为 Base64，进入 PowerShell 后明确解码，避免标准输入被系统代码页误读。

### 2.0.2 调整

- 顶部导航与底部四个入口固定显示；Android 版顶部始终显示“更新”，可从当前已安装版本升级。
- 默认本机音色切换到较新的 Microsoft Huihui；创作设置新增 Microsoft Kangkang、Microsoft Yaoyao，缺失时回退到兼容音色。

### 2.0.3 调整

- 历史侧栏支持向左滑动或点遮罩关闭；创作设置支持向下滑动、点空白和 Esc 关闭。
- Android 原生页面按状态栏、导航栏和屏幕刘海的系统 Insets 留白；网页导航在可用区域内排版。

### 2.0.4 调整

- 预览加入可拖动时间轴；松手后画面与后续配音从所选位置继续，导出期间禁用拖动。
- 移除预览画面右下角的英文装饰字及预览区底部技术说明；生成完成直接进入可编辑创作界面。

## 六、扩展能力时的边界

- 不把 DeepSeek API Key 放入 `app.js`、静态网页或 `.env.example`；密钥只存在后端 `.env`。
- `.env`、`.private/`、`.cache/`、`.venv-voice/`、`node_modules/`、生成后的 `android/`、`www/` 已列入忽略项；不要把这些目录复制到交接源码包。
- 默认离线配音只支持 Windows 后端的 System.Speech；手机 App 连接该电脑后由电脑合成。
- 目前只在原 Windows 电脑构建过 APK。新笔记本若只运行网站，无需安装 Android Studio、JDK 或 Android SDK。
- Android 工程由 Capacitor 生成；当前工作区内保留了远程升级所需的原生源码改动。首次升级必须人工安装一次 1.1，旧 APK 尚无升级入口。
- 网站导出在浏览器端录画面，服务端只负责音频和 MP4 转码；部署到公网前还需补上鉴权、限流、上传限制与可靠的密钥管理。

## 七、源码包内容

`知映-源码移交.zip` 包含网站运行所需的源码、锁文件、示例、远程升级所需的 Android 原生改动片段和本说明；不包含 `.env` 密钥、录音原件、模型缓存、`node_modules`、生成后的完整安卓工程或 APK。若要在新电脑构建远程升级 APK，先运行 `npx cap add android` 和 `npm run mobile:sync`，再按 `native-patches/README.md` 覆盖对应文件。
