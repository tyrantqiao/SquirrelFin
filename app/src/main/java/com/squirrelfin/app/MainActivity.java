package com.squirrelfin.app;

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import java.io.*;
import org.json.JSONObject;

/** Offline shell. No INTERNET permission; only packaged assets may navigate. */
public class MainActivity extends Activity {
    private WebView web;
    private String pendingBackup;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xfff6f5f1);
        getWindow().setNavigationBarColor(0xfff6f5f1);
        web = new WebView(this);
        web.setOnApplyWindowInsetsListener((view, insets) -> {
            view.setPadding(insets.getSystemWindowInsetLeft(), insets.getSystemWindowInsetTop(),
                    insets.getSystemWindowInsetRight(), insets.getSystemWindowInsetBottom());
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new Storage(), "LocalDevice");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
        });
        setContentView(web);
        web.requestApplyInsets();
        web.loadUrl("file:///android_asset/index.html");
    }
    public class Storage {
        @JavascriptInterface public String read() {
            try (FileInputStream in = new android.util.AtomicFile(new File(getFilesDir(), "wealth.json")).openRead()) {
                ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
                while ((n = in.read(b)) != -1) out.write(b, 0, n);
                return out.toString("UTF-8");
            } catch (FileNotFoundException e) { return ""; }
            catch (Exception e) { return "__READ_ERROR__"; }
        }
        @JavascriptInterface public boolean save(String json) {
            try {
                new JSONObject(json);
                android.util.AtomicFile f = new android.util.AtomicFile(new File(getFilesDir(), "wealth.json"));
                FileOutputStream out = null;
                try { out = f.startWrite(); out.write(json.getBytes("UTF-8")); f.finishWrite(out); }
                catch (Exception e) { if (out != null) f.failWrite(out); throw e; }
                return true;
            } catch (Exception e) { return false; }
        }
        @JavascriptInterface public void exportBackup(String json) {
            runOnUiThread(() -> {
                pendingBackup = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT); i.setType("application/json");
                i.addCategory(Intent.CATEGORY_OPENABLE); i.putExtra(Intent.EXTRA_TITLE, "SquirrelFin-backup.json");
                startActivityForResult(i, 1);
            });
        }
        @JavascriptInterface public void importBackup() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.setType("*/*");
                i.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(i, 2);
            });
        }
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (result != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        try {
            if (request == 1) {
                try (OutputStream out = getContentResolver().openOutputStream(uri)) { out.write(pendingBackup.getBytes("UTF-8")); }
                web.evaluateJavascript("App.toast('备份已导出')", null);
            } else if (request == 2) {
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
                    while ((n = in.read(b)) != -1) { if (out.size() + n > 5_000_000) throw new IOException("Too large"); out.write(b, 0, n); }
                    web.evaluateJavascript("App.importText(" + JSONObject.quote(out.toString("UTF-8")) + ")", null);
                }
            }
        } catch (Exception e) { web.evaluateJavascript("App.toast('文件操作失败，请重试')", null); }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("App.back()", result -> { if ("false".equals(result)) finish(); });
    }
}
