# Capacitor Android 原生改动

由 `npx cap add android` 生成 Android 工程并执行 `npm run mobile:sync` 后，把本目录下的内容复制到生成的 `android/` 同路径位置：

- `app/build.gradle`：包名及版本号；后续发版需提高 `versionCode`。
- `app/src/main/AndroidManifest.xml`：联网、局域网 HTTP 联调和安装 APK 权限。
- `app/src/main/java/com/zhiying/education/MainActivity.java`：注册本地 `AppUpdaterPlugin`。
- `app/src/main/java/com/zhiying/education/AppUpdaterPlugin.java`：下载 APK、校验 SHA-256、调用系统安装器。
- `app/src/main/res/xml/file_paths.xml`：限制 FileProvider 只暴露升级缓存目录。

如本机 Android Gradle Plugin 因工作目录含中文报路径错误，可在 `android/gradle.properties` 中添加 `android.overridePathCheck=true`。`local.properties` 应由 Android Studio 按本机 SDK 路径生成，不要从别的电脑复制。
