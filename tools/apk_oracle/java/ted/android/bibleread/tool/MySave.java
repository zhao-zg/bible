package ted.android.bibleread.tool;

import android.content.Context;

/** Stub：只保留 Quote 用到的版本选择（versions_42 的 0-based 下标）。 */
public class MySave {
    public static Integer getSelectBook(Context context) {
        return Context.selectBook;
    }
}
