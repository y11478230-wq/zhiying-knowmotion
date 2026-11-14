package com.zhiying.education;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.BufferedInputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final long MAX_APK_BYTES = 150L * 1024L * 1024L;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getInstalledVersion(PluginCall call) {
        try {
            android.content.pm.PackageInfo info = getContext().getPackageManager()
                    .getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= 28 ? info.getLongVersionCode() : info.versionCode;
            JSObject result = new JSObject();
            result.put("versionCode", code);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("读取当前 App 版本失败", error);
        }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String address = call.getString("url", "");
        String expectedSha256 = call.getString("sha256", "").toLowerCase(Locale.ROOT);
        if (!address.matches("^https?://[^\\s]+$") || !expectedSha256.matches("^[0-9a-f]{64}$")) {
            call.reject("升级地址或校验码无效");
            return;
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                && !getContext().getPackageManager().canRequestPackageInstalls()) {
            try {
                Intent settings = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:" + getContext().getPackageName()));
                getActivity().startActivity(settings);
                JSObject result = new JSObject();
                result.put("requiresPermission", true);
                call.resolve(result);
            } catch (Exception error) {
                call.reject("无法打开安装权限设置", error);
            }
            return;
        }

        executor.execute(() -> downloadApk(call, address, expectedSha256));
    }

    private void downloadApk(PluginCall call, String address, String expectedSha256) {
        HttpURLConnection connection = null;
        File updateDir = new File(getContext().getCacheDir(), "updates");
        File partial = new File(updateDir, "update.apk.part");
        File apk = new File(updateDir, "update.apk");
        try {
            URL url = new URL(address);
            if (url.getUserInfo() != null) throw new IllegalArgumentException("升级地址不能包含账号信息");
            if (!updateDir.exists() && !updateDir.mkdirs()) throw new IllegalStateException("无法创建升级缓存目录");

            connection = (HttpURLConnection) url.openConnection();
            connection.setInstanceFollowRedirects(true);
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(60_000);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive");
            int status = connection.getResponseCode();
            if (status != HttpURLConnection.HTTP_OK) throw new IllegalStateException("下载失败（HTTP " + status + "）");
            if (connection.getContentLengthLong() > MAX_APK_BYTES) throw new IllegalStateException("升级包超过 150 MiB");

            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            long received = 0;
            long total = connection.getContentLengthLong();
            partial.delete();
            try (InputStream input = new BufferedInputStream(connection.getInputStream());
                 FileOutputStream output = new FileOutputStream(partial)) {
                byte[] buffer = new byte[64 * 1024];
                int count;
                while ((count = input.read(buffer)) != -1) {
                    received += count;
                    if (received > MAX_APK_BYTES) throw new IllegalStateException("升级包超过 150 MiB");
                    digest.update(buffer, 0, count);
                    output.write(buffer, 0, count);
                    if (total > 0) {
                        JSObject progress = new JSObject();
                        progress.put("percent", Math.min(100, (int) (received * 100 / total)));
                        notifyListeners("downloadProgress", progress);
                    }
                }
                output.getFD().sync();
            }

            StringBuilder actual = new StringBuilder();
            for (byte value : digest.digest()) actual.append(String.format(Locale.ROOT, "%02x", value & 0xff));
            if (!MessageDigest.isEqual(actual.toString().getBytes("US-ASCII"), expectedSha256.getBytes("US-ASCII"))) {
                throw new SecurityException("升级包校验失败，请检查本机服务和网络");
            }
            if (apk.exists() && !apk.delete()) throw new IllegalStateException("无法替换旧升级包");
            if (!partial.renameTo(apk)) throw new IllegalStateException("无法保存升级包");

            getActivity().runOnUiThread(() -> {
                try {
                    Uri uri = FileProvider.getUriForFile(getContext(),
                            getContext().getPackageName() + ".fileprovider", apk);
                    Intent installer = new Intent(Intent.ACTION_VIEW);
                    installer.setDataAndType(uri, "application/vnd.android.package-archive");
                    installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                    getActivity().startActivity(installer);
                    JSObject result = new JSObject();
                    result.put("requiresPermission", false);
                    result.put("installerOpened", true);
                    call.resolve(result);
                } catch (Exception error) {
                    call.reject("已下载升级包，但无法打开 Android 安装器", error);
                }
            });
        } catch (Exception error) {
            partial.delete();
            String message = error.getMessage() == null ? "升级包下载失败" : error.getMessage();
            getActivity().runOnUiThread(() -> call.reject(message, error));
        } finally {
            if (connection != null) connection.disconnect();
        }
    }
}
