package android.content;

import java.util.HashMap;
import java.util.Map;

/** Stub：只提供 Quote / MyTool 用到的 getString(int)。字符串来自 APK resources.arsc。 */
public class Context {
    public static final Map<Integer, String> STRINGS = new HashMap<>();
    public static int selectBook = 1;

    public final String getString(int id) {
        String s = STRINGS.get(id);
        if (s == null) throw new RuntimeException("Resources$NotFoundException: 0x" + Integer.toHexString(id));
        return s;
    }

    public final String getString(int id, Object... args) {
        return String.format(getString(id), args);
    }
}
