package com.squirrelfin.app;

import android.app.Activity;
import android.content.Intent;
import android.content.pm.*;
import android.net.Uri;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.io.*;
import java.net.*;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import org.json.*;

/** Update traffic never contains ledger data. Persistent partial files use HTTP Range. */
public class Updater {
    private final Activity activity;
    private final WebView web;
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private volatile boolean busy, paused;
    private JSONObject release;
    private volatile String phase = "idle", message = "点击检测更新", version = "";
    private long downloaded, total;
    private final File partial, apk, metadata;
    private static final String REPO = "https://github.com/tyrantqiao/SquirrelFin/releases/";
    public Updater(Activity a, WebView w) {
        activity=a; web=w; partial=new File(a.getFilesDir(), "update.part");
        apk=new File(a.getFilesDir(), "update.apk"); metadata=new File(a.getFilesDir(), "update.json");
        try { version=a.getPackageManager().getPackageInfo(a.getPackageName(),0).versionName;
            if(metadata.exists()) { release=new JSONObject(new String(read(new FileInputStream(metadata),100000),"UTF-8")); if(apk.exists()&&!partial.exists())apk.renameTo(partial); downloaded=partial.length(); total=release.getLong("size"); if(compare(release.getString("version"),version)<=0){release=null;partial.delete();apk.delete();metadata.delete();downloaded=total=0;}else{phase="paused"; message="有未完成的下载，可继续";} }
        } catch(Exception e) { release=null; }
    }
    private static byte[] read(InputStream input, int limit) throws IOException {
        try(InputStream in=input; ByteArrayOutputStream out=new ByteArrayOutputStream()) {
            byte[] b=new byte[8192]; int n; while((n=in.read(b))!=-1) { if(out.size()+n>limit)throw new IOException("响应过大"); out.write(b,0,n); } return out.toByteArray();
        }
    }
    static int compare(String a,String b) {
        String[] x=a.replaceFirst("^v","").split("\\."),y=b.replaceFirst("^v","").split("\\.");
        for(int i=0;i<Math.max(x.length,y.length);i++){int d=Integer.compare(i<x.length?Integer.parseInt(x[i]):0,i<y.length?Integer.parseInt(y[i]):0);if(d!=0)return d;}return 0;
    }
    private HttpURLConnection connect(String url) throws Exception {
        URL u=new URL(url); String host=u.getHost();
        if(!"https".equals(u.getProtocol()) || !(host.equals("github.com")||host.equals("release-assets.githubusercontent.com")||host.equals("objects.githubusercontent.com")))throw new IOException("下载地址不受支持");
        HttpURLConnection c=(HttpURLConnection)u.openConnection(); c.setConnectTimeout(15000);c.setReadTimeout(20000);c.setInstanceFollowRedirects(false);c.setRequestProperty("User-Agent","SquirrelFin/"+version);c.setRequestProperty("Accept-Encoding","identity");return c;
    }
    private HttpURLConnection request(String url,long offset) throws Exception { return request(url,offset,"GET"); }
    private HttpURLConnection request(String url,long offset,String method) throws Exception {
        for(int i=0;i<6;i++) { HttpURLConnection c=connect(url);c.setRequestMethod(method);if(offset>0)c.setRequestProperty("Range","bytes="+offset+"-");int code=c.getResponseCode();
            if(code>=300&&code<400){String location=c.getHeaderField("Location");url=new URL(new URL(url),location).toString();c.disconnect();continue;}return c;
        }throw new IOException("重定向过多");
    }
    @JavascriptInterface public synchronized String status() {
        JSONObject s=new JSONObject();try{s.put("current",version).put("phase",phase).put("message",message).put("downloaded",downloaded).put("total",total);if(release!=null)s.put("release",release);}catch(Exception ignored){}return s.toString();
    }
    private synchronized void emit(String p,String m) { phase=p;message=m;String json=status();activity.runOnUiThread(()->web.evaluateJavascript("App.updateStatus("+json+")",null)); }
    static String assetName(String html,String tag) throws IOException {
        String prefix="/tyrantqiao/SquirrelFin/releases/download/"+tag+"/";
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("href=\""+java.util.regex.Pattern.quote(prefix)+"(SquirrelFin-"+java.util.regex.Pattern.quote(tag.replaceFirst("^v",""))+"(?:-debug)?\\.apk)\"").matcher(html);
        java.util.Set<String> names=new java.util.HashSet<>();while(m.find())names.add(m.group(1));
        if(names.size()!=1)throw new IOException("Release 安装包缺失或不唯一");return names.iterator().next();
    }
    static String checksum(String text,String name) throws IOException {
        String[] lines=text.trim().split("\\r?\\n");
        if(lines.length!=1)throw new IOException("SHA-256 文件格式不受支持");
        java.util.regex.Matcher m=java.util.regex.Pattern.compile("([0-9a-fA-F]{64})[ \\t]+\\*?"+java.util.regex.Pattern.quote(name)).matcher(lines[0]);
        if(!m.matches())throw new IOException("SHA-256 文件与安装包不匹配");return m.group(1);
    }
    private String fetchText(String url,int limit) throws Exception {
        HttpURLConnection c=request(url,0);try{if(c.getResponseCode()!=200)throw new IOException("无法获取 Release 文件（HTTP "+c.getResponseCode()+"）");return new String(read(c.getInputStream(),limit),"UTF-8");}finally{c.disconnect();}
    }
    private JSONObject websiteRelease() throws Exception {
        HttpURLConnection c=request(REPO+"latest",0);String tag;
        try{String page=c.getURL().toString();if(c.getResponseCode()!=200||!page.startsWith(REPO+"tag/"))throw new IOException("无法获取最新正式 Release");tag=page.substring((REPO+"tag/").length());if(!tag.matches("v?\\d+\\.\\d+\\.\\d+"))throw new IOException("Release 版本格式不受支持");}finally{c.disconnect();}
        JSONObject data=new JSONObject().put("tag_name",tag).put("assets",new JSONArray());
        if(compare(tag,version)<=0)return data;
        String name=assetName(fetchText(REPO+"expanded_assets/"+tag,1000000),tag),url=REPO+"download/"+tag+"/"+name;
        String digest=checksum(fetchText(url+".sha256",4096),name);long size;
        c=request(url,0,"HEAD");try{if(c.getResponseCode()!=200)throw new IOException("无法获取安装包大小");size=c.getContentLengthLong();}finally{c.disconnect();}
        data.getJSONArray("assets").put(new JSONObject().put("name",name).put("browser_download_url",url).put("digest","sha256:"+digest).put("size",size));
        return data.put("body","完整更新说明请查看 GitHub Release。");
    }
    @JavascriptInterface public synchronized void check() {
        if(busy)return;busy=true;emit("checking","正在检测 GitHub Release…");worker.execute(()->{
            try {JSONObject data=websiteRelease();
                String tag=data.getString("tag_name");if(data.optBoolean("draft")||data.optBoolean("prerelease")||!tag.matches("v?\\d+\\.\\d+\\.\\d+"))throw new IOException("Release 版本格式不受支持");
                if(compare(tag,version)<=0){emit("latest","当前已是最新版本");return;}
                JSONArray assets=data.getJSONArray("assets");JSONObject candidate=null;
                for(int i=0;i<assets.length();i++){JSONObject a=assets.getJSONObject(i);if(a.getString("name").matches("SquirrelFin-"+tag.replaceFirst("^v","").replace(".","\\.")+"(?:-debug)?\\.apk")){if(candidate!=null)throw new IOException("Release 存在多个安装包");candidate=a;}}
                if(candidate==null)throw new IOException("Release 尚未提供适配安装包");
                String url=candidate.getString("browser_download_url"),digest=candidate.optString("digest");long size=candidate.getLong("size");
                if(!url.startsWith(REPO+"download/"+tag+"/")||!digest.matches("sha256:[0-9a-fA-F]{64}")||size<=0||size>200000000)throw new IOException("安装包地址、大小或 SHA-256 不完整");
                JSONObject next=new JSONObject().put("version",tag).put("url",url).put("digest",digest.substring(7)).put("size",size).put("notes",data.optString("body")).put("page",REPO+"tag/"+tag);
                if(release==null||!release.optString("digest").equals(next.getString("digest"))){partial.delete();apk.delete();downloaded=0;}
                release=next;total=size;saveMetadata();emit("available","发现新版本");
            }catch(Exception e){emit("error",e.getMessage()==null?"检测失败，请重试":e.getMessage());}finally{busy=false;}
        });
    }
    private void saveMetadata() throws Exception {
        android.util.AtomicFile f=new android.util.AtomicFile(metadata);FileOutputStream out=null;
        try{out=f.startWrite();out.write(release.toString().getBytes("UTF-8"));f.finishWrite(out);}catch(Exception e){if(out!=null)f.failWrite(out);throw e;}
    }
    @JavascriptInterface public void pause() { paused=true; }
    @JavascriptInterface public synchronized void download() {
        if(busy||release==null||phase.equals("latest"))return;busy=true;paused=false;emit("downloading","正在下载，可暂停后继续");worker.execute(()->{
            HttpURLConnection c=null;
            try {long offset=partial.length();total=release.getLong("size");if(offset>total){partial.delete();offset=0;}
                if(offset<total){c=request(release.getString("url"),offset);int code=c.getResponseCode();
                    if(code==200){offset=0;}else if(code==206){String range=c.getHeaderField("Content-Range");if(range==null||!range.startsWith("bytes "+offset+"-")||!range.endsWith("/"+total))throw new IOException("断点响应不匹配，请重新检测");}else throw new IOException("下载失败（HTTP "+code+"），可继续重试");
                    try(InputStream in=c.getInputStream();RandomAccessFile out=new RandomAccessFile(partial,"rw")){if(offset==0)out.setLength(0);out.seek(offset);downloaded=offset;byte[] b=new byte[65536];int n;long last=0;
                        while(!paused&&(n=in.read(b))!=-1){if(downloaded+n>total)throw new IOException("下载大小异常");out.write(b,0,n);downloaded+=n;if(System.currentTimeMillis()-last>500){emit("downloading","正在下载，可暂停后继续");last=System.currentTimeMillis();}}out.getFD().sync();}
                }
                if(paused){emit("paused","下载已暂停，进度已保存");return;}if(partial.length()!=total)throw new IOException("连接中断，可继续下载");
                emit("verifying","正在校验安装包…");MessageDigest md=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(partial)){byte[] b=new byte[65536];int n;while((n=in.read(b))!=-1)md.update(b,0,n);}StringBuilder hash=new StringBuilder();for(byte b:md.digest())hash.append(String.format("%02x",b&255));
                if(!hash.toString().equalsIgnoreCase(release.getString("digest"))){partial.delete();downloaded=0;throw new IOException("SHA-256 校验失败，请重新下载");}
                PackageManager pm=activity.getPackageManager();PackageInfo archive=pm.getPackageArchiveInfo(partial.getPath(),PackageManager.GET_SIGNATURES),current=pm.getPackageInfo(activity.getPackageName(),PackageManager.GET_SIGNATURES);
                if(archive==null||!current.packageName.equals(archive.packageName)||archive.versionCode<=current.versionCode||archive.signatures==null||!java.util.Arrays.equals(archive.signatures,current.signatures)||compare(archive.versionName,release.getString("version"))!=0){partial.delete();downloaded=0;throw new IOException("安装包版本、包名或签名不匹配");}
                apk.delete();if(!partial.renameTo(apk))throw new IOException("安装包保存失败");emit("ready","校验通过，可以安装更新");
            }catch(Exception e){emit("paused",e.getMessage()==null?"网络中断，可继续下载":e.getMessage());}finally{if(c!=null)c.disconnect();busy=false;}
        });
    }
    @JavascriptInterface public void install() { activity.runOnUiThread(()->{
        if(!phase.equals("ready")||!apk.exists())return;
        try{if(!activity.getPackageManager().canRequestPackageInstalls()){activity.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:"+activity.getPackageName())));emit("ready","请允许安装此来源应用，返回后点击安装");return;}
            Intent i=new Intent(Intent.ACTION_VIEW);i.setDataAndType(Uri.parse("content://"+activity.getPackageName()+".updates/update.apk"),"application/vnd.android.package-archive");i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);activity.startActivity(i);
        }catch(Exception e){emit("ready","无法打开安装器，请检查系统安装权限");}
    }); }
    @JavascriptInterface public void openRelease() { activity.runOnUiThread(()->{try{activity.startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(REPO)));}catch(Exception ignored){}}); }
}
