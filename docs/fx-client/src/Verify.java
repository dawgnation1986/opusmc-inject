import com.bigpixel.comet.render.*;
import java.util.*;

/** 纯 Java 数值冒烟：不依赖 MC / Meteor，javac 25 直接跑。 */
public class Verify {
    static int pass = 0, fail = 0;
    static void ok(boolean c, String label, Object detail) {
        System.out.println((c ? "PASS " : "FAIL ") + label + (detail == null ? "" : "  " + detail));
        if (c) pass++; else fail++;
    }

    public static void main(String[] args) {
        // ---- 图案几何 ----
        int seg = 720;
        ok(CometGeometry.GEOMETRY.length == 9 && CometGeometry.MOTION.length == 8,
           "17 种模式 = 9 几何 + 8 动效", CometGeometry.GEOMETRY.length + "+" + CometGeometry.MOTION.length);
        ok(CometGeometry.localMaxima(CometGeometry.sample("五芒星", seg, 1, 0, 0)) == 5,
           "五芒星一圈恰好 5 个尖（不是 10 尖）",
           CometGeometry.localMaxima(CometGeometry.sample("五芒星", seg, 1, 0, 0)));
        ok(CometGeometry.localMaxima(CometGeometry.sample("六芒星", seg, 1, 0, 0)) == 6,
           "六芒星 6 尖", CometGeometry.localMaxima(CometGeometry.sample("六芒星", seg, 1, 0, 0)));
        ok(CometGeometry.localMaxima(CometGeometry.sample("三角阵", seg, 1, 0, 0)) == 3,
           "三角阵 3 尖", CometGeometry.localMaxima(CometGeometry.sample("三角阵", seg, 1, 0, 0)));
        ok(CometGeometry.localMaxima(CometGeometry.sample("六边形", seg, 1, 0, 0)) == 6,
           "六边形 6 个顶点", CometGeometry.localMaxima(CometGeometry.sample("六边形", seg, 1, 0, 0)));
        ok(CometGeometry.tips("五芒星") == 5 && CometGeometry.tips("齿轮") == 12
           && CometGeometry.tips("螺旋") == 0 && CometGeometry.tips("极光") == 0,
           "尖角发光数表正确", null);
        ok(CometGeometry.nextTip(0, 5) == 2 && CometGeometry.nextTip(4, 5) == 1,
           "pentagram 跳点连线 i→(i+2)%5", null);

        // 正多边形要有直边：极坐标 r=1/cos(...) 本来就不是线性，二阶差分判不了。
        // 正确判据是「笛卡尔坐标下相邻三点共线」——叉积接近 0。
        double[] poly = CometGeometry.sample("六边形", seg, 1, 0, 0);
        int flat = 0, checked = 0;
        for (int i = 1; i < seg - 1; i++) {
            double a0 = CometGeometry.TAU * (i-1) / seg;
            double a1 = CometGeometry.TAU * i / seg;
            double a2 = CometGeometry.TAU * (i+1) / seg;
            double x0 = Math.cos(a0)*poly[i-1], y0 = Math.sin(a0)*poly[i-1];
            double x1 = Math.cos(a1)*poly[i],   y1 = Math.sin(a1)*poly[i];
            double x2 = Math.cos(a2)*poly[i+1], y2 = Math.sin(a2)*poly[i+1];
            double cross = (x1-x0)*(y2-y0) - (y1-y0)*(x2-x0);
            checked++;
            if (Math.abs(cross) < 1e-9) flat++;
        }
        ok(flat > checked * 0.8, "六边形大部分区段三点共线 = 直边（不是 cos 波浪圆）",
           flat + "/" + checked);

        // 动效型模式半径恒为圆
        boolean circle = true;
        double[] m = CometGeometry.sample("彩虹", seg, 2, 1.7, 0.9);
        for (double v : m) if (Math.abs(v - 2) > 1e-9) circle = false;
        ok(circle, "8 种动效模式半径恒为圆，差异靠布尔开关", null);

        // 半径恒正、无 NaN
        boolean finite = true;
        for (String s : CometGeometry.GEOMETRY)
            for (double v : CometGeometry.sample(s, 240, 3, 12.5, 0.7))
                if (!Double.isFinite(v) || v <= 0) finite = false;
        ok(finite, "9 种图案在所有角度半径有限且为正", null);

        // ---- 颜色 ----
        int[] red = CometColor.hsv(0, 1, 1);
        ok(red[0] == 255 && red[1] == 0 && red[2] == 0, "HSV(0,1,1) = 纯红", Arrays.toString(red));
        int[] cyan = CometColor.hsv(180, 1, 1);
        ok(cyan[0] == 0 && cyan[1] == 255 && cyan[2] == 255, "HSV(180,1,1) = 青", Arrays.toString(cyan));
        int c = CometColor.rainbow(3.2, 0.5, 200);
        ok(CometColor.alpha(c) == 200, "彩虹颜色 alpha 保留", CometColor.alpha(c));
        ok(CometColor.lerp(0xFF000000, 0xFFFFFFFF, 0.5f) == 0xFF7F7F7F,
           "lerp 中点是半灰", Integer.toHexString(CometColor.lerp(0xFF000000, 0xFFFFFFFF, 0.5f)));
        ok(CometColor.fromHex("#b06bff", 255) == 0xFFB06BFF, "#b06bff 解析正确", null);
        ok(CometColor.healthColor(1, 255) == 0xFF002828 || CometColor.green(CometColor.healthColor(1,255)) == 255,
           "满血偏绿", null);
        ok(CometColor.red(CometColor.healthColor(0, 255)) == 255, "空血偏红", null);

        // ---- 缓动 ----
        ok(CometEase.inOutCubic(0) == 0 && CometEase.inOutCubic(1) == 1, "ease 端点 0/1", null);
        ok(Math.abs(CometEase.inOutCubic(0.5) - 0.5) < 1e-9, "ease(0.5)=0.5", CometEase.inOutCubic(0.5));
        ok(CometEase.inOutCubic(-3) == 0 && CometEase.inOutCubic(9) == 1, "ease 越界钳制", null);
        double[] ph = CometEase.introPhases(0.04);
        ok(ph[0] > 0 && ph[0] < 1 && ph[1] == 0, "开场 0.04：黑幕淡入中、图案未开始", Arrays.toString(ph));
        double[] mid = CometEase.introPhases(0.45);
        ok(mid[0] == 1 && mid[1] > 0 && mid[1] < 1 && mid[2] == 1,
           "开场 0.45：全黑底、图案组装中、未淡出", Arrays.toString(mid));
        double[] end = CometEase.introPhases(1.0);
        ok(end[2] == 0 && end[3] == 0, "开场 1.0：完全淡出", Arrays.toString(end));

        // ---- 绘制数学 ----
        var dashes = CometShapesMath.dashSegments(10, 2, 1);
        ok(dashes.size() == 4 && dashes.get(3)[1] == 10,
           "虚线切分不越界（最后一段截断到总长）", dashes.size());
        var fletch = CometShapesMath.arrowFletching(
            new CometShapesMath.P3(0,5,0), new CometShapesMath.P3(0,1,0), 0.5);
        ok(fletch.size() == 4 && fletch.stream().allMatch(p -> Double.isFinite(p.x())),
           "箭头 4 片羽片坐标有限", null);
        double[] sector = CometShapesMath.cornerSector(10, 10, 4, 180, 8);
        ok(sector.length == 48, "圆角扇区 8 段 × 三角形 6 坐标", sector.length);
        var rib = CometShapesMath.ribbon(new CometShapesMath.P2(0,0),
                                         new CometShapesMath.P2(10,0), 1);
        ok(rib.length == 4 && rib[0].y() == 1 && rib[1].y() == -1,
           "ribbon quad 宽度 = 2×halfWidth", Arrays.toString(rib));
        double[] pt = CometShapesMath.particle(42, 3.3, 2, 0);
        ok(Double.isFinite(pt[0]) && Double.isFinite(pt[1]) && pt[1] >= 0,
           "粒子确定性且 y 有限", Arrays.toString(pt));
        double[] a = CometShapesMath.particle(42, 3.3, 2, 0);
        double[] b = CometShapesMath.particle(42, 3.3, 2, 0);
        ok(Arrays.equals(a, b), "同一粒子两次计算完全一致（不闪烁）", null);
        double[] j0 = CometShapesMath.jitter(30, 0, 0);
        ok(j0[0] == 0 && j0[1] == 0, "碎片归位完成后 jitter 归零", Arrays.toString(j0));
        ok(CometShapesMath.BOX_EDGES.length == 12, "3D 框恰好 12 边", null);
        for (int k = 0; k < 3; k++) {
            double q = CometShapesMath.ringWave(0.7, k);
            ok(q >= 0 && q < 1, "扩散光环相位 k=" + k + " 归一化", q);
        }

        System.out.println("---");
        System.out.println(fail == 0 ? ("ALL PASS (" + pass + " assertions)") : (fail + " FAILED / " + pass));
        System.exit(fail == 0 ? 0 : 1);
    }
}
