package com.bigpixel.comet.render;

import java.util.ArrayList;
import java.util.List;

/** 绘制几何的纯数学部分：虚线切分、箭头羽片、圆角扇区、ribbon 展开。可单测。 */
public final class CometShapesMath {
    private CometShapesMath() {}
    public static final double TAU = Math.PI * 2;

    public record P2(double x, double y) {}
    public record P3(double x, double y, double z) {}
    /** 一段线：两个端点 */
    public record Segment(P3 a, P3 b) {}

    /** 虚线切分：返回 [t0,t1] 参数对（相对总长度） */
    public static List<double[]> dashSegments(double len, double dash, double gap) {
        List<double[]> out = new ArrayList<>();
        if (len <= 0 || dash <= 0 || gap < 0) return out;
        for (double t = 0; t < len; t += dash + gap) {
            out.add(new double[]{ t, Math.min(t + dash, len) });
        }
        return out;
    }

    /** 3D 箭头的四片羽片端点。dir 需已归一化。 */
    public static List<P3> arrowFletching(P3 to, P3 dir, double headLen) {
        List<P3> out = new ArrayList<>();
        P3 up = Math.abs(dir.y()) > 0.9 ? new P3(1, 0, 0) : new P3(0, 1, 0);
        P3 side = normalize(cross(dir, up));
        P3 other = normalize(cross(dir, side));
        double bx = to.x() - dir.x() * headLen;
        double by = to.y() - dir.y() * headLen;
        double bz = to.z() - dir.z() * headLen;
        double s = headLen * 0.45;
        for (P3 v : new P3[]{ side, scale(side, -1), other, scale(other, -1) })
            out.add(new P3(bx + v.x() * s, by + v.y() * s, bz + v.z() * s));
        return out;
    }

    public static P3 cross(P3 a, P3 b) {
        return new P3(a.y() * b.z() - a.z() * b.y(),
                      a.z() * b.x() - a.x() * b.z(),
                      a.x() * b.y() - a.y() * b.x());
    }
    public static P3 scale(P3 p, double k) { return new P3(p.x()*k, p.y()*k, p.z()*k); }
    public static P3 normalize(P3 p) {
        double l = Math.sqrt(p.x()*p.x() + p.y()*p.y() + p.z()*p.z());
        return l < 1e-9 ? new P3(0,0,0) : scale(p, 1/l);
    }

    /**
     * 圆角矩形的一个 90° 扇区，返回 seg 个三角形的顶点（每 6 个 double 是一个三角形：x1,y1,x2,y2,x3,y3）。
     * startDeg 是起始角度（度），按顺时针增长 90°。
     */
    public static double[] cornerSector(double cx, double cy, double rad,
                                        double startDeg, int seg) {
        double[] out = new double[seg * 6];
        double step = 90.0 / seg;
        for (int i = 0; i < seg; i++) {
            double a1 = Math.toRadians(startDeg + i * step);
            double a2 = Math.toRadians(startDeg + (i + 1) * step);
            out[i*6]   = cx;                       out[i*6+1] = cy;
            out[i*6+2] = cx + Math.cos(a1)*rad;   out[i*6+3] = cy + Math.sin(a1)*rad;
            out[i*6+4] = cx + Math.cos(a2)*rad;   out[i*6+5] = cy + Math.sin(a2)*rad;
        }
        return out;
    }

    /**
     * 线段扩成 ribbon quad（绕开驱动把 lineWidth 钳到 1 的限制）。
     * 屏幕空间用：返回 4 个 2D 点，按 (a-left, a-right, b-right, b-left) 顺序，可直接拆成两个三角形。
     */
    public static P2[] ribbon(P2 a, P2 b, double halfWidth) {
        double dx = b.x() - a.x(), dy = b.y() - a.y();
        double len = Math.hypot(dx, dy);
        if (len < 1e-9) return new P2[]{ a, a, a, a };
        double nx = -dy / len * halfWidth, ny = dx / len * halfWidth;
        return new P2[]{
            new P2(a.x()+nx, a.y()+ny), new P2(a.x()-nx, a.y()-ny),
            new P2(b.x()-nx, b.y()-ny), new P2(b.x()+nx, b.y()+ny)
        };
    }

    /** 环绕粒子：确定性伪随机（黄金角），禁止用 Random，否则每帧闪烁 */
    public static double[] particle(int i, double t, double radius, double yBase) {
        double a = t * 0.6 + i * 2.399963;                  // 黄金角
        double frac = CometGeometry.mod(i * 0.618, 1);
        double rr = radius * (0.6 + 0.4 * frac);
        double yy = yBase + 0.3 + 1.2 * frac(Math.sin(i * 12.9898) * 43758.5453)
                          + 0.25 * Math.sin(t * 1.7 + i);
        return new double[]{ Math.cos(a)*rr, yy, Math.sin(a)*rr, a };
    }
    public static double frac(double x) { return x - Math.floor(x); }

    /** 开场动画的碎片归位：确定性 jitter，settle=1-assemble */
    public static double[] jitter(int i, int layer, double settle) {
        double jx = Math.sin(i * 12.9898 + layer * 7.1) * settle * 0.35;
        double jy = Math.cos(i * 78.233 + layer * 3.3) * settle * 0.35;
        return new double[]{ jx, jy };
    }

    /** 扩散光环相位：3 道，q∈[0,1) */
    public static double ringWave(double p, int k) {
        return CometGeometry.mod(p * 1.35 - k * 0.16, 1);
    }

    /** 3D 框 12 边的顶点索引对（Meteor boxLines 的顺序） */
    public static final int[][] BOX_EDGES = {
        {0,4},{1,5},{2,6},{3,7},     // 竖边
        {0,1},{2,3},{0,2},{1,3},     // 底环
        {4,5},{6,7},{4,6},{5,7}      // 顶环
    };
}
