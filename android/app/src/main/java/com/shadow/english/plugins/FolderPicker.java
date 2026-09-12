package com.shadow.english.plugins;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.content.ContentResolver;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import java.util.ArrayList;
import java.util.List;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 文件夹选择器 v5（Activity Result Launcher 版）：
 *
 * 根因：Capacitor 8 的 Bridge.onActivityResult 只把结果路由给
 * 「已注册 requestCode 的插件」，我们自己 startActivityWithResult(1002/1003)
 * 的结果被丢进 Cordova 死胡同，永远到不了插件。
 *
 * 方案：和 WebView 的 onShowFileChooser（网页文件选择，实测可用）走同一条
 * AndroidX ActivityResultLauncher 通道 —— bridge.registerForActivityResult。
 * 用户选完文件夹后，原生端直接用 SAF 递归遍历整棵目录树，把所有音频
 * 文件的 URI 列表写进 SharedPreferences；JS 端轮询 getPendingFiles() 取走。
 */
@CapacitorPlugin(name = "FolderPicker")
public class FolderPicker extends Plugin {

    private static final String[] AUDIO_EXTS = {"mp3", "m4a", "aac", "wav", "ogg", "opus", "flac", "amr", "webm"};
    private static final String PREFS = "folder_picker_results";
    private static final String KEY_PENDING = "pending_files";

    private ActivityResultLauncher<Intent> folderLauncher;

    @Override
    public void load() {
        folderLauncher = bridge.registerForActivityResult(
                new ActivityResultContracts.StartActivityForResult(),
                result -> {
                    if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) return;
                    Uri treeUri = result.getData().getData();
                    if (treeUri == null) return;
                    try {
                        handleFolderResult(treeUri);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                });
    }

    /** 选择整个文件夹（全选入口）：打开系统文档树选择器 */
    @PluginMethod
    public void pickFolder(PluginCall call) {
        if (folderLauncher == null) {
            call.reject("文件夹选择器初始化失败，请用普通多选输入框分批添加");
            return;
        }
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION
                | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        clearPending();
        try {
            folderLauncher.launch(intent);
            call.resolve();
        } catch (Exception e) {
            call.reject("无法打开文件夹选择器: " + e.getMessage());
        }
    }

    /** JS 轮询读取扫描结果（读后清空） */
    @PluginMethod
    public void getPendingFiles(PluginCall call) {
        SharedPreferences prefs = getContext().getSharedPreferences(PREFS, 0);
        String json = prefs.getString(KEY_PENDING, null);
        if (json == null) {
            JSObject ret = new JSObject();
            ret.put("files", new org.json.JSONArray());
            call.resolve(ret);
            return;
        }
        clearPending();
        try {
            org.json.JSONArray arr = new org.json.JSONArray(json);
            JSObject ret = new JSObject();
            ret.put("files", arr);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("读取结果失败: " + e.getMessage());
        }
    }

    private void clearPending() {
        getContext().getSharedPreferences(PREFS, 0)
                .edit().remove(KEY_PENDING).apply();
    }

    private void savePending(String json) {
        getContext().getSharedPreferences(PREFS, 0)
                .edit().putString(KEY_PENDING, json).apply();
    }

    /** 遍历选中文件夹的整棵树，收集音频文件 */
    private void handleFolderResult(Uri treeUri) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        try {
            resolver.takePersistableUriPermission(treeUri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignore) {}

        List<JSObject> files = new ArrayList<>();
        walkTree(resolver, DocumentsContract.buildDocumentUriUsingTree(
                treeUri, DocumentsContract.getTreeDocumentId(treeUri)), files);

        if (!files.isEmpty()) {
            savePending(toArray(files).toString());
        }
    }

    private org.json.JSONArray toArray(List<JSObject> files) {
        org.json.JSONArray arr = new org.json.JSONArray();
        for (JSObject f : files) arr.put(f);
        return arr;
    }

    private void walkTree(ContentResolver resolver, Uri docUri, List<JSObject> out) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(
                docUri, DocumentsContract.getDocumentId(docUri));
        try (android.database.Cursor c = resolver.query(childrenUri,
                new String[]{DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                        DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                        DocumentsContract.Document.COLUMN_MIME_TYPE,
                        DocumentsContract.Document.COLUMN_SIZE}, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String docId = c.getString(0);
                String name = c.getString(1);
                String mime = c.getString(2);
                long size = c.getLong(3);
                Uri fileUri = DocumentsContract.buildDocumentUriUsingTree(docUri, docId);
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mime)) {
                    walkTree(resolver, fileUri, out); // 递归子目录
                } else {
                    String ext = getExt(name);
                    String kind = kindOf(ext, mime);
                    if (kind == null) continue;
                    JSObject f = new JSObject();
                    f.put("name", name);
                    f.put("uri", fileUri.toString());
                    f.put("size", size);
                    f.put("kind", kind);
                    out.add(f);
                }
            }
        }
    }

    private String getExt(String name) {
        if (name == null) return "";
        int i = name.lastIndexOf('.');
        return i < 0 ? "" : name.substring(i + 1).toLowerCase();
    }

    private String kindOf(String ext, String mime) {
        for (String a : AUDIO_EXTS) if (a.equals(ext)) return "audio";
        if (mime != null && mime.startsWith("audio/")) return "audio";
        return null;
    }
}
