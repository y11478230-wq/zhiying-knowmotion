# 知映 Android 本机远程升级说明

## 当前实现

当前准备发布版本：**2.3.1（versionCode 18）**。优化初高中长视频课堂的章节生成与配音准备。App 遇到旧服务缺少新接口时，会尝试同主机后续本地端口（4174、4175）并记住可用的新版后端地址。发布前必须保留原电脑的 Android Debug Keystore；不要更换 `applicationId`。

- App 设置里可以填写电脑后端地址，并检查电脑发布的最新 APK。
- 服务端的 `GET /api/app-update` 提供版本号、升级说明与 SHA-256；`GET /api/app-update/apk` 流式提供 APK。
- App 下载到私有缓存，校验 SHA-256 后交给 Android 安装器。用户需要在系统安装界面确认；Android 8 及以上首次可能要给“知映”打开“允许安装未知应用”。
- Android 包名固定为 `com.zhiying.education`。覆盖升级还要求新 APK 使用与手机旧版相同的签名证书。

## 用电脑构建并发布升级

在项目根目录运行：

```powershell
npm run mobile:sync
$env:JAVA_HOME = 'D:\arduino\jdk-21'
Push-Location android
.\gradlew.bat assembleDebug
Pop-Location
npm run mobile:publish
npm start
```

`mobile:publish` 会将 `android/app/build/outputs/apk/debug/app-debug.apk` 复制到 `releases/zhiying.apk`，并生成带有版本号与 SHA-256 的 `releases/update.json`。升级信息和 APK 由当前 Node 服务提供。

需要发布后续版本时，先在 `android/app/build.gradle` 同时增加 `versionCode`（每次必须递增）和 `versionName`，再重新 sync、build、publish。不要更换 `applicationId`。同一台 Windows 用户账户构建的 Debug APK 会使用本机 Android Debug Keystore；不要删除或重置 `%USERPROFILE%\.android\debug.keystore`，否则手机无法覆盖安装。

## 手机连接这台电脑

### 推荐：USB + ADB 端口转发

这种方式不用把 Node 服务开放给 Wi-Fi 里的其他设备，电脑后端保持 `HOST=127.0.0.1` 即可。

1. 手机用 USB 连接电脑，打开 Android 开发者选项中的 USB 调试，并在手机上允许此电脑调试。
2. 在电脑项目目录运行 `npm start`，保持终端窗口打开。
3. 在另一个 PowerShell 窗口运行：

   ```powershell
   & 'D:\arduino\platform-tools\adb.exe' devices
   & 'D:\arduino\platform-tools\adb.exe' reverse tcp:4173 tcp:4173
   ```

   `devices` 应显示一台 `device`，不要是 `unauthorized`。端口转发后，手机里的 `127.0.0.1:4173` 会通到电脑服务。

4. 首次安装 1.1 可用 USB 覆盖安装：

   ```powershell
   & 'D:\arduino\platform-tools\adb.exe' install -r '.\知映-debug.apk'
   ```

   或复制 APK 到手机手动安装。旧版 1.0 没有更新入口，必须先手动安装这一次 1.1。

5. 打开知映 App，点“服务地址”，输入 `http://127.0.0.1:4173`。检查状态显示服务已连接后，点“检查更新”。

6. 之后发布新版本并重新运行 `npm run mobile:publish`，保持 `npm start` 与 USB 端口转发运行，App 内即可检查、下载并调起系统安装器。

### 备选：同一可信 Wi-Fi

两台设备连到自己的路由器或个人热点。在项目目录另开 PowerShell 窗口运行：

```powershell
cd 'C:\Users\25624\Desktop\黑客松'
$env:HOST = '0.0.0.0'
npm start
```

该设置只对这个终端会话生效；`.env` 中的跨域来源白名单已允许 Capacitor 本地页面。电脑执行 `ipconfig` 查实际 Wi-Fi IPv4，然后 App 的“服务地址”填写 `http://电脑IPv4:4173`。若 Windows 防火墙拦截，只给专用网络或手机 IP 添加 TCP 4173 入站规则。

当前电脑连着的 Wi-Fi 被 Windows 标为“公用”，地址 `192.168.100.200`。不要为整个公用网络开放 4173；建议切到个人热点或可信路由器后再启用 Wi-Fi 方案。

首次安装基线版，把单独提供的知映 1.1 APK 通过 USB“文件传输”复制到手机并手动安装。设置本机服务地址后，App 会发现服务上已发布的 1.2。后续不需再传文件，只要服务运行且两台设备互通即可。

## 连接失败时

- USB 方式确认 `adb reverse tcp:4173 tcp:4173` 已执行，且电脑服务仍在运行。
- 确认手机浏览器能打开电脑地址的首页，以及 `/api/app-update` 能返回 JSON。
- 确认手机 App 的“服务地址”没有多余路径，必须是 `http://电脑IPv4:4173`。
- 公司／校园 Wi-Fi 可能隔离无线设备；换到同一手机热点或个人路由器测试。
- 手机安装已下载 APK 时若提示“应用未安装”，常见原因是包名不一致、APK 签名与已安装版不同或版本号没有递增。

## 使用范围

此方案适用于手机与开发电脑在同一局域网。离开局域网后，手机无法访问笔记本私网地址；要做互联网远程升级，需要部署可公网访问的 HTTPS 服务并配置域名、防火墙、鉴权与发布存储。当前 `android:usesCleartextTraffic="true"` 只为本机 HTTP 联调方便；公网部署应改 HTTPS 并收紧明文流量策略。
