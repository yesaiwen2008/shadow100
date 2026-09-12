package com.shadow.english.plugins;

import android.app.Activity;
import android.content.ContentValues;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.view.WindowManager;
import android.widget.Toast;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * 原生工具 v1：
 *  1) keepAwake / allowSleep —— 录音期间保持屏幕常亮。根源：录音时用户
 *     不碰屏幕，约 60 秒系统息屏后 WebView 被暂停、麦克风被系统掐断，
 *     表现为「录音只有约 1 分钟」。
 *  2) saveBegin / saveChunk / saveEnd —— 把 JS 端 blob 分块写入公共
 *     Download/影子100/ 目录。根源：WebView 里 <a download> 的 blob
 *     下载不落地，导出的文件根本没保存到手机上，所以搜不到。
 *     Android 10+ 走 MediaStore（免权限），旧版本直接写公共 Download。
 */
@CapacitorPlugin(name = "NativeUtils")
public class NativeUtils extends Plugin {

    private OutputStream saveStream = null;
    private Uri pendingUri = null;   // Android 10+：MediaStore 待完成记录
    private String savePath = "";

    // ---------- 屏幕常亮 ----------

    @PluginMethod
    public void keepAwake(PluginCall call) {
        bridge.executeOnMainThread(() -> {
            Activity act = bridge.getActivity();
            if (act != null && !act.isFinishing()) {
                act.getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }

    @PluginMethod
    public void allowSleep(PluginCall call) {
        bridge.executeOnMainThread(() -> {
            Activity act = bridge.getActivity();
            if (act != null && !act.isFinishing()) {
                act.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            }
        });
        call.resolve();
    }

    // ---------- 分块保存到 Download/影子100/ ----------

    @PluginMethod
    public void saveBegin(PluginCall call) {
        bridge.execute(() -> {
            String filename = call.getString("filename");
            String mime = call.getString("mimeType");
            if (filename == null || filename.trim().isEmpty()) {
                call.reject("缺少文件名");
                return;
            }
            if (mime == null || mime.isEmpty()) mime = "application/octet-stream";

            closeQuietly(); // 清理上一次未完成的保存

            try {
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                    cv.put(MediaStore.Downloads.MIME_TYPE, mime);
                    cv.put(MediaStore.Downloads.RELATIVE_PATH,
                            Environment.DIRECTORY_DOWNLOADS + "/影子100");
                    cv.put(MediaStore.Downloads.IS_PENDING, 1);
                    pendingUri = getContext().getContentResolver()
                            .insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
                    if (pendingUri == null) { call.reject("无法创建下载记录"); return; }
                    saveStream = getContext().getContentResolver().openOutputStream(pendingUri);
                    savePath = "Download/影子100/" + filename;
                } else {
                    File dir = new File(
                            Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS),
                            "影子100");
                    if (!dir.exists() && !dir.mkdirs()) { call.reject("无法创建目录"); return; }
                    File f = new File(dir, filename);
                    int i = 1;
                    while (f.exists()) {
                        int dot = filename.lastIndexOf('.');
                        String base = dot > 0 ? filename.substring(0, dot) : filename;
                        String ext = dot > 0 ? filename.substring(dot) : "";
                        f = new File(dir, base + "(" + (i++) + ")" + ext);
                    }
                    saveStream = new FileOutputStream(f);
                    savePath = f.getAbsolutePath();
                }
                if (saveStream == null) { call.reject("无法打开输出流"); return; }
                JSObject ret = new JSObject();
                ret.put("path", savePath);
                call.resolve(ret);
            } catch (Exception e) {
                closeQuietly();
                call.reject("创建文件失败: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void saveChunk(PluginCall call) {
        bridge.execute(() -> {
            String b64 = call.getString("base64");
            if (b64 == null || saveStream == null) { call.reject("尚未开始保存"); return; }
            try {
                byte[] buf = Base64.decode(b64, Base64.DEFAULT);
                saveStream.write(buf);
                saveStream.flush();
                call.resolve();
            } catch (Exception e) {
                closeQuietly();
                call.reject("写入失败: " + e.getMessage());
            }
        });
    }

    @PluginMethod
    public void saveEnd(PluginCall call) {
        bridge.execute(() -> {
            try {
                if (saveStream == null) { call.reject("尚未开始保存"); return; }
                saveStream.flush();
                saveStream.close();
                saveStream = null;
                if (pendingUri != null && Build.VERSION.SDK_INT >= 29) {
                    ContentValues cv = new ContentValues();
                    cv.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContext().getContentResolver().update(pendingUri, cv, null, null);
                    pendingUri = null;
                }
                final String path = savePath;
                bridge.executeOnMainThread(() ->
                        Toast.makeText(getContext(), "已保存：" + path, Toast.LENGTH_LONG).show());
                JSObject ret = new JSObject();
                ret.put("path", path);
                call.resolve(ret);
            } catch (Exception e) {
                closeQuietly();
                call.reject("完成保存失败: " + e.getMessage());
            }
        });
    }

    private void closeQuietly() {
        try { if (saveStream != null) saveStream.close(); } catch (Exception ignored) {}
        saveStream = null;
        pendingUri = null;
    }
}
