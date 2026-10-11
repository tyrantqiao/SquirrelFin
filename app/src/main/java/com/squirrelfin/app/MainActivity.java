package com.squirrelfin.app;

import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.graphics.Insets;
import android.view.WindowInsets;
import android.view.DisplayCutout;
import android.widget.FrameLayout;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.JavascriptInterface;
import android.content.Intent;
import android.net.Uri;
import java.io.*;
import org.json.JSONObject;

/** Offline shell. Update-only networking; only packaged assets may navigate. */
public class MainActivity extends Activity {
    private WebView web;
    private String pendingBackup;
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xfff6f5f1);
        getWindow().setNavigationBarColor(0xfff6f5f1);
        if (Build.VERSION.SDK_INT >= 30) getWindow().setDecorFitsSystemWindows(false);
        web = new WebView(this);
        // Resize the WebView's actual bounds, including fixed HTML navigation and dialogs.
        FrameLayout content = new FrameLayout(this);
        content.setBackgroundColor(0xfff6f5f1);
        content.addView(web, new FrameLayout.LayoutParams(-1, -1));
        content.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
            } else {
                int left = insets.getSystemWindowInsetLeft(), top = insets.getSystemWindowInsetTop();
                int right = insets.getSystemWindowInsetRight(), bottom = insets.getSystemWindowInsetBottom();
                if (Build.VERSION.SDK_INT >= 28) {
                    DisplayCutout cutout = insets.getDisplayCutout();
                    if (cutout != null) {
                        left = Math.max(left, cutout.getSafeInsetLeft());
                        top = Math.max(top, cutout.getSafeInsetTop());
                        right = Math.max(right, cutout.getSafeInsetRight());
                        bottom = Math.max(bottom, cutout.getSafeInsetBottom());
                    }
                }
                view.setPadding(left, top, right, bottom);
            }
            return insets;
        });
        web.getSettings().setJavaScriptEnabled(true);
        web.getSettings().setDomStorageEnabled(true);
        web.getSettings().setAllowFileAccess(false);
        web.getSettings().setAllowContentAccess(false);
        web.addJavascriptInterface(new Storage(), "LocalDevice");
        web.addJavascriptInterface(new Updater(this, web), "DeviceUpdater");
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return true; }
        });
        setContentView(content);
        content.requestApplyInsets();
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
        @JavascriptInterface public void importLedger() {
            runOnUiThread(() -> {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT); i.setType("*/*");
                i.addCategory(Intent.CATEGORY_OPENABLE); startActivityForResult(i, 3);
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
            } else if (request == 2 || request == 3) {
                try (InputStream in = getContentResolver().openInputStream(uri)) {
                    ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
                    int limit = request == 3 ? 600_000 : 5_000_000;
                    while ((n = in.read(b)) != -1) { if (out.size() + n > limit) throw new IOException("Too large"); out.write(b, 0, n); }
                    String callback = request == 3 ? "App.importLedgerText(" : "App.importText(";
                    web.evaluateJavascript(callback + JSONObject.quote(out.toString("UTF-8")) + ")", null);
                }
            }
        } catch (Exception e) { web.evaluateJavascript("App.toast('文件操作失败，请重试')", null); }
    }
    @Override public void onBackPressed() {
        web.evaluateJavascript("App.back()", result -> { if ("false".equals(result)) finish(); });
    }
}
