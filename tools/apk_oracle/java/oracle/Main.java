package oracle;

import android.content.Context;
import ted.android.bibleread.read.ChapterNode;
import ted.android.bibleread.tool.Quote;
import ted.android.bibleread.tool.SQLHelper;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.sql.DriverManager;
import java.util.ArrayList;

/**
 * 正版引经解析基准：直接运行 APK 里的 ted.android.bibleread.tool.Quote 字节码。
 *
 * 外层循环逐条复刻 QuoteFragment.setListView()（按「，」切分、用上一段末行作上下文、
 * 约壹一6 的硬编码特例、空内容过滤），依据是该方法的 javap 字节码。
 *
 * 用法: Main <sqlite> <strings.tsv> <tw|cn> <selectBook 0|1> <input.tsv> <output.tsv>
 *   strings.tsv: 资源id \t 名称 \t 繁体(默认)值 \t 简体(zh-rCN)值
 *   input      : id \t 书 \t 章 \t 节 \t 文本
 *   output     : id \t OK|EXC \t 结果行 \t 每段结果
 *   结果行     : V:书:章:节:unit  /  N:书:章:节:unit:注号
 */
public class Main {
    public static void main(String[] a) throws Exception {
        int col = a[2].equals("cn") ? 3 : 2;
        try (BufferedReader r = Files.newBufferedReader(Paths.get(a[1]), StandardCharsets.UTF_8)) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] p = line.split("\t", -1);
                if (p.length < 4) continue;
                Context.STRINGS.put(Integer.parseInt(p[0]), p[col]);
            }
        }
        Context.selectBook = Integer.parseInt(a[3]);
        Class.forName("org.sqlite.JDBC");
        SQLHelper.CONN = DriverManager.getConnection("jdbc:sqlite:file:" + a[0].replace('\\', '/') + "?mode=ro&immutable=1");

        Context ctx = new Context();
        ArrayList<String> bookData = SQLHelper.selectBook().get(Context.selectBook);
        ArrayList<String> simpleTitle = SQLHelper.getDataFrom(bookData.get(2));
        ArrayList<String> onlyOne = SQLHelper.getOnlyOne(bookData.get(2));

        int n = 0, exc = 0;
        try (BufferedReader in = Files.newBufferedReader(Paths.get(a[4]), StandardCharsets.UTF_8);
             BufferedWriter out = Files.newBufferedWriter(Paths.get(a[5]), StandardCharsets.UTF_8)) {
            String line;
            while ((line = in.readLine()) != null) {
                String[] p = line.split("\t", -1);
                if (p.length < 5) continue;
                int book = Integer.parseInt(p[1]);
                int chapter = Integer.parseInt(p[2]);
                String verse = p[3];
                String text = p[4].replace("\\n", "\n");

                ArrayList<ArrayList<String>> all = new ArrayList<>();
                StringBuilder dbg = new StringBuilder();
                String status = "OK";
                ChapterNode node = null;
                for (String str : text.replaceAll("\"", "").split("，")) {
                    ArrayList<ArrayList<String>> start;
                    try {
                        if (node != null) {
                            start = new Quote(ctx, bookData, simpleTitle, onlyOne, str, node.getChapterCode(), node.getSectionCode(), node.getSegmentCode()).start();
                        } else if (book == 62 && chapter == 1 && verse.equals("6") && str.equals("7、8、9、10、22")) {
                            start = new Quote(ctx, bookData, simpleTitle, onlyOne, str, book, 3, verse).start();
                        } else {
                            start = new Quote(ctx, bookData, simpleTitle, onlyOne, str, book, chapter, verse).start();
                        }
                        if (!start.isEmpty()) {
                            node = new ChapterNode(start.get(start.size() - 1));
                        }
                    } catch (Throwable e) {
                        status = "EXC";                 // 真机上这里是未捕获异常（闪退）
                        dbg.append("[").append(str).append("=>").append(e.getClass().getSimpleName()).append("]");
                        break;
                    }
                    all.addAll(start);
                    dbg.append("[").append(str).append("=>").append(fmt(start)).append("]");
                }
                if (status.equals("EXC")) exc++;
                out.write(p[0] + "\t" + status + "\t" + fmt(all) + "\t" + dbg.toString().replaceAll("[\\t\\r\\n]", " "));
                out.write("\n");
                n++;
            }
        }
        System.err.println("oracle: " + n + " rows, " + exc + " crashed");
    }

    /** QuoteFragment 的展示过滤：注解行(>=8列)看第 8 列、经文行看第 6 列，空内容不展示。 */
    static String fmt(ArrayList<ArrayList<String>> rows) {
        StringBuilder sb = new StringBuilder();
        for (ArrayList<String> row : rows) {
            if (row.size() >= 8) {
                if (row.get(7) == null || row.get(7).trim().isEmpty()) continue;
                if (sb.length() > 0) sb.append(' ');
                sb.append("N:").append(row.get(1)).append(':').append(row.get(2)).append(':').append(row.get(3)).append(':').append(row.get(4)).append(':').append(row.get(6));
            } else {
                if (row.get(5) == null || row.get(5).trim().isEmpty()) continue;
                if (sb.length() > 0) sb.append(' ');
                sb.append("V:").append(row.get(1)).append(':').append(row.get(2)).append(':').append(row.get(3)).append(':').append(row.get(4));
            }
        }
        return sb.toString();
    }
}
