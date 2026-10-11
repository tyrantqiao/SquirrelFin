package com.squirrelfin.app;

public class UpdaterReleaseTest {
    interface Check { void run() throws Exception; }
    static void rejects(Check check) throws Exception {
        try { check.run(); } catch (java.io.IOException expected) { return; }
        throw new AssertionError("Unsafe release accepted");
    }
    public static void main(String[] args) throws Exception {
        String prefix="/tyrantqiao/SquirrelFin/releases/download/v0.1.5/";
        String link="<a href=\""+prefix+"SquirrelFin-0.1.5.apk\">APK</a>";
        if(!Updater.assetName(link+link,"v0.1.5").equals("SquirrelFin-0.1.5.apk"))throw new AssertionError();
        rejects(()->Updater.assetName(link.replace("tyrantqiao","other"),"v0.1.5"));
        rejects(()->Updater.assetName(link,"v0.1.6"));
        rejects(()->Updater.assetName(link+link.replace(".apk","-debug.apk"),"v0.1.5"));
        String hash="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
        if(!Updater.checksum(hash+"  SquirrelFin-0.1.5.apk\r\n","SquirrelFin-0.1.5.apk").equals(hash))throw new AssertionError();
        rejects(()->Updater.checksum(hash+"  other.apk","SquirrelFin-0.1.5.apk"));
        rejects(()->Updater.checksum("abcd  SquirrelFin-0.1.5.apk","SquirrelFin-0.1.5.apk"));
        rejects(()->Updater.checksum(hash+"  SquirrelFin-0.1.5.apk\n"+hash+"  other.apk","SquirrelFin-0.1.5.apk"));
        System.out.println("Release fallback validation passed");
    }
}
