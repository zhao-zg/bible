package com.bible.reader;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // 重要：必须在 super.onCreate() 之前注册自定义插件
        registerPlugin(ApkInstallerPlugin.class);

        // 提前绑定 TTS 引擎，省去 2-3 秒初始化延迟
        TTSForegroundService.prewarmTts(this);
        super.onCreate(savedInstanceState);
    }
}
