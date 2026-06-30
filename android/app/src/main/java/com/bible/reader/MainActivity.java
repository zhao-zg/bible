package com.bible.reader;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        // 提前绑定 TTS 引擎，省去 2-3 秒初始化延迟
        TTSForegroundService.prewarmTts(this);
        super.onCreate(savedInstanceState);
    }
}
