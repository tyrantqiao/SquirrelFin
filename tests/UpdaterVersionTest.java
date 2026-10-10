package com.squirrelfin.app;
public class UpdaterVersionTest {
    public static void main(String[] args) {
        if(Updater.compare("v0.1.10","0.1.9")<=0)throw new AssertionError("numeric patch update");
        if(Updater.compare("v0.1.3","0.1.3")!=0)throw new AssertionError("same release");
        if(Updater.compare("v0.1.2","0.1.3")>=0)throw new AssertionError("downgrade");
        if(Updater.compare("v1.0.0","0.99.99")<=0)throw new AssertionError("major update");
        System.out.println("Updater version boundaries passed");
    }
}
