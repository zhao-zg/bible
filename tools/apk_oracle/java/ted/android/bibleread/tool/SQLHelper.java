package ted.android.bibleread.tool;

import android.content.Context;

import java.sql.Connection;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * 正版 SQLHelper 的等价替身：只实现 Quote 调用到的方法。
 *
 * SQL 文本逐字取自反编译的正版 SQLHelper；数字型参数走内存快路径（按 rowid 顺序全表
 * 过滤，与 SQLite 全表扫描的结果集及顺序一致），其余一律把原 SQL 交给 SQLite 执行，
 * 语法错误以 RuntimeException 抛出（对应 Android 的 SQLiteException）。
 */
public class SQLHelper {
    public static Connection CONN;
    public static long fastHits = 0, rawHits = 0;

    private static final String KEY3 = " ( chapter_code ||  ( CASE LENGTH ( section_code ) WHEN 1 THEN ( '00' || section_code ) WHEN 2 THEN ( '0' || section_code ) ELSE section_code END )  || ( CASE LENGTH ( segment_code ) WHEN 1 THEN ( '00' || segment_code ) WHEN 2 THEN ( '0' || segment_code ) ELSE segment_code END ) ) AS 'k'  FROM ";
    private static final String CAST3 = " WHERE  CAST ( chapter_code ||  ( CASE LENGTH ( section_code ) WHEN 1 THEN ( '00' || section_code ) WHEN 2 THEN ( '0' || section_code ) ELSE section_code END )  || ( CASE LENGTH ( segment_code ) WHEN 1 THEN ( '00' || segment_code ) WHEN 2 THEN ( '0' || segment_code ) ELSE segment_code END ) AS INTEGER )  BETWEEN ";
    private static final String KEY4 = " ( chapter_code ||  ( CASE LENGTH ( section_code ) WHEN 1 THEN ( '00' || section_code ) WHEN 2 THEN ( '0' || section_code ) ELSE section_code END )  || ( CASE LENGTH ( segment_code ) WHEN 1 THEN ( '00' || segment_code ) WHEN 2 THEN ( '0' || segment_code ) ELSE segment_code END )  || ( CASE LENGTH ( note_num ) WHEN 1 THEN ( '00' || note_num ) WHEN 2 THEN ( '0' || note_num ) ELSE note_num END ) ) AS 'k'  FROM ";
    private static final String CAST4 = " WHERE  CAST ( chapter_code ||  ( CASE LENGTH ( section_code ) WHEN 1 THEN ( '00' || section_code ) WHEN 2 THEN ( '0' || section_code ) ELSE section_code END )  || ( CASE LENGTH ( segment_code ) WHEN 1 THEN ( '00' || segment_code ) WHEN 2 THEN ( '0' || segment_code ) ELSE segment_code END ) || ( CASE LENGTH ( note_num ) WHEN 1 THEN ( '00' || note_num ) WHEN 2 THEN ( '0' || note_num ) ELSE note_num END )  AS INTEGER )  BETWEEN ";

    private static final class Table {
        ArrayList<ArrayList<String>> rows = new ArrayList<>();
        int[] ch, sec, seg, num;
        long[] key3, key4;
        String[] key3Text, key4Text;
        boolean hasNum;
    }

    private static final Map<String, Table> TABLES = new HashMap<>();
    private static final Map<String, ArrayList<String>> SECTION_CACHE = new HashMap<>();

    public SQLHelper(Context context) {
    }

    public void close() {
    }

    private static String addZero(int i) {
        String num = Integer.toString(i);
        return num.length() == 1 ? "00" + num : num.length() == 2 ? "0" + num : num;
    }

    private static String addZero(String str) {
        return str.length() == 1 ? "00" + str : str.length() == 2 ? "0" + str : str;
    }

    private static boolean digits(String s) {
        if (s == null || s.isEmpty() || s.length() > 17) return false;
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c < '0' || c > '9') return false;
        }
        return true;
    }

    private static Table table(String name) {
        Table t = TABLES.get(name);
        if (t != null) return t;
        t = new Table();
        try (Statement st = CONN.createStatement(); ResultSet rs = st.executeQuery("SELECT * FROM " + name + " ORDER BY rowid")) {
            ResultSetMetaData md = rs.getMetaData();
            int n = md.getColumnCount();
            int iCh = -1, iSec = -1, iSeg = -1, iNum = -1;
            for (int i = 1; i <= n; i++) {
                String c = md.getColumnName(i).toLowerCase();
                if (c.equals("chapter_code")) iCh = i;
                else if (c.equals("section_code")) iSec = i;
                else if (c.equals("segment_code")) iSeg = i;
                else if (c.equals("note_num")) iNum = i;
            }
            ArrayList<int[]> meta = new ArrayList<>();
            while (rs.next()) {
                ArrayList<String> row = new ArrayList<>(n);
                for (int i = 1; i <= n; i++) row.add(rs.getString(i));
                t.rows.add(row);
                meta.add(new int[]{rs.getInt(iCh), rs.getInt(iSec), rs.getInt(iSeg), iNum > 0 ? rs.getInt(iNum) : 0});
            }
            int m = meta.size();
            t.hasNum = iNum > 0;
            t.ch = new int[m]; t.sec = new int[m]; t.seg = new int[m]; t.num = new int[m];
            t.key3 = new long[m]; t.key4 = new long[m];
            t.key3Text = new String[m]; t.key4Text = new String[m];
            for (int i = 0; i < m; i++) {
                int[] x = meta.get(i);
                t.ch[i] = x[0]; t.sec[i] = x[1]; t.seg[i] = x[2]; t.num[i] = x[3];
                t.key3Text[i] = x[0] + addZero(x[1]) + addZero(x[2]);
                t.key3[i] = Long.parseLong(t.key3Text[i]);
                if (t.hasNum) {
                    t.key4Text[i] = t.key3Text[i] + addZero(x[3]);
                    t.key4[i] = Long.parseLong(t.key4Text[i]);
                }
            }
        } catch (SQLException e) {
            throw new RuntimeException("SQLiteException: " + e.getMessage());
        }
        TABLES.put(name, t);
        return t;
    }

    private static ArrayList<ArrayList<String>> raw(String sql) {
        rawHits++;
        ArrayList<ArrayList<String>> out = new ArrayList<>();
        try (Statement st = CONN.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            int n = rs.getMetaData().getColumnCount();
            while (rs.next()) {
                ArrayList<String> row = new ArrayList<>(n);
                for (int i = 1; i <= n; i++) row.add(rs.getString(i));
                out.add(row);
            }
        } catch (SQLException e) {
            throw new RuntimeException("SQLiteException: " + e.getMessage());
        }
        return out;
    }

    private static ArrayList<ArrayList<String>> range3(String tbl, String lo, String hi) {
        if (!digits(lo) || !digits(hi)) {
            return raw("SELECT * ," + KEY3 + tbl + CAST3 + lo + " AND " + hi);
        }
        fastHits++;
        Table t = table(tbl);
        long a = Long.parseLong(lo), b = Long.parseLong(hi);
        ArrayList<ArrayList<String>> out = new ArrayList<>();
        for (int i = 0; i < t.key3.length; i++) {
            long k = t.key3[i];
            if (k >= a && k <= b) {
                ArrayList<String> row = new ArrayList<>(t.rows.get(i));
                row.add(t.key3Text[i]);
                out.add(row);
            }
        }
        return out;
    }

    ArrayList<String> getBeadFrom(String str, int i, int i2, String str2, String str3) {
        ArrayList<String> flat = new ArrayList<>();
        for (ArrayList<String> row : raw("SELECT * FROM " + str + " WHERE chapter_code = " + i + " AND section_code = " + i2 + " AND segment_code = " + str2 + " AND beaded = '\"" + str3 + "\"'")) {
            flat.addAll(row);
        }
        return flat;
    }

    public ArrayList<String> getSectionData(String str, int i) {
        String k = str + "#" + i;
        ArrayList<String> cached = SECTION_CACHE.get(k);
        if (cached == null) {
            cached = new ArrayList<>();
            for (ArrayList<String> row : raw("SELECT segment_code FROM " + str + " WHERE chapter_code = " + i + " AND id IN ( SELECT MAX ( id ) FROM " + str + " GROUP BY chapter_code , section_code )")) {
                cached.add(row.get(0));
            }
            SECTION_CACHE.put(k, cached);
        }
        return new ArrayList<>(cached);
    }

    ArrayList<ArrayList<String>> searchContent(String str, int i, int i2, String str2) {
        if (!digits(str2)) {
            return raw("SELECT * FROM " + str + " WHERE chapter_code = " + i + " AND section_code = " + i2 + " AND segment_code = " + str2);
        }
        fastHits++;
        Table t = table(str);
        int v = Integer.parseInt(str2);
        ArrayList<ArrayList<String>> out = new ArrayList<>();
        for (int r = 0; r < t.ch.length; r++) {
            if (t.ch[r] == i && t.sec[r] == i2 && t.seg[r] == v) out.add(new ArrayList<>(t.rows.get(r)));
        }
        return out;
    }

    ArrayList<ArrayList<String>> searchFootNote(String str, int i, int i2, String str2, String str3) {
        if (!digits(str2) || !digits(str3)) {
            return raw("SELECT * FROM " + str + " WHERE chapter_code = " + i + " AND section_code = " + i2 + " AND segment_code = " + str2 + " AND note_num = " + str3);
        }
        fastHits++;
        Table t = table(str);
        int v = Integer.parseInt(str2), n = Integer.parseInt(str3);
        ArrayList<ArrayList<String>> out = new ArrayList<>();
        for (int r = 0; r < t.ch.length; r++) {
            if (t.ch[r] == i && t.sec[r] == i2 && t.seg[r] == v && t.num[r] == n) out.add(new ArrayList<>(t.rows.get(r)));
        }
        return out;
    }

    ArrayList<ArrayList<String>> searchRange(String str, int i, int i2, String str2, int i3, int i4, String str3) {
        return range3(str, i + addZero(Integer.toString(i2)) + addZero(str2), i3 + addZero(Integer.toString(i4)) + addZero(str3));
    }

    ArrayList<ArrayList<String>> searchRangeFootnote(String str, int i, int i2, String str2, int i3, int i4, String str3) {
        return range3(str, i + addZero(i2) + addZero(str2), i3 + addZero(i4) + addZero(str3));
    }

    ArrayList<ArrayList<String>> searchRangeFootnote(String str, int i, int i2, String str2, String str3, int i3, int i4, String str4, String str5) {
        String lo = i + addZero(i2) + addZero(str2) + addZero(str3);
        String hi = i3 + addZero(i4) + addZero(str4) + addZero(str5);
        Table t = table(str);
        if (!digits(lo) || !digits(hi) || !t.hasNum) {
            return raw("SELECT * ," + KEY4 + str + CAST4 + lo + " AND " + hi);
        }
        fastHits++;
        long a = Long.parseLong(lo), b = Long.parseLong(hi);
        ArrayList<ArrayList<String>> out = new ArrayList<>();
        for (int r = 0; r < t.key4.length; r++) {
            long k = t.key4[r];
            if (k >= a && k <= b) {
                ArrayList<String> row = new ArrayList<>(t.rows.get(r));
                row.add(t.key4Text[r]);
                out.add(row);
            }
        }
        return out;
    }

    /* 以下供 harness 复现 QuoteFragment.selectBook() */
    public static ArrayList<ArrayList<String>> selectBook() {
        return raw("SELECT * FROM versions_42");
    }

    public static ArrayList<String> getDataFrom(String str) {
        ArrayList<String> out = new ArrayList<>();
        for (ArrayList<String> row : raw(" SELECT abbreviation FROM " + str)) out.add(row.get(row.size() - 1).replaceAll("\"", ""));
        return out;
    }

    public static ArrayList<String> getOnlyOne(String str) {
        ArrayList<String> out = new ArrayList<>();
        for (ArrayList<String> row : raw(" SELECT abbreviation FROM " + str + " WHERE chapter_sum = 1")) out.add(row.get(row.size() - 1).replaceAll("\"", ""));
        return out;
    }
}
