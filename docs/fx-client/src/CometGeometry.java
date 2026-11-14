package com.bigpixel.comet.render;

/**
 * 光环图案的极坐标半径。纯 Java，不依赖 Minecraft / Meteor，可单测。
 * 公式逐行对应 opusmc-hud.user.js:2058-2087（cmShapeRadius）。
 */
public final class CometGeometry {
    private CometGeometry() {}
    public static final double TAU = Math.PI * 2;

    public static final String[] GEOMETRY = {
        "五芒星", "六芒星", "三角阵", "菱形", "六边形", "花瓣", "齿轮", "螺旋", "星轨"
    };
    /** 动效型模式半径恒为圆，靠布尔开关区分 */
    public static final String[] MOTION = {
        "极光", "彩虹", "波浪", "脉冲", "旋转", "双层", "粒子", "音乐律动"
    };

    public static double mod(double a, double n) {
        double r = a % n;
        return r < 0 ? r + n : r;
    }

    public static boolean isGeometry(String mode) {
        for (String s : GEOMETRY) if (s.equals(mode)) return true;
        return false;
    }

    /** n 尖星：周期 2π/n。写成 2π/(2n) 会变成 2n 个尖（五芒星变 10 尖）。 */
    public static double star(int n, double inner, double a, double rad, double phase) {
        double seg = TAU / n;
        double u = mod(a + phase, seg);
        double half = seg / 2;
        double f = u < half ? 1 - u / half : (u - half) / half;
        return rad * (inner + (1 - inner) * f);
    }

    /** 正 n 边形极坐标方程：直边，不是用 cos 调出来的波浪圆。 */
    public static double poly(int n, double a, double rad, double phase) {
        double seg = TAU / n;
        double u = mod(a + phase, seg);
        return rad * Math.cos(Math.PI / n) / Math.max(0.2, Math.cos(u - seg / 2));
    }

    public static double radius(String shape, double a, double rad, double t, double phase) {
        return switch (shape) {
            case "五芒星" -> star(5, 0.44, a, rad, phase) * (1 + 0.06 * Math.sin(t * 2.4));
            case "六芒星" -> star(6, 0.50, a, rad, phase);
            case "三角阵" -> star(3, 0.42, a, rad, phase);
            case "菱形"   -> poly(4, a, rad, phase);
            case "六边形" -> poly(6, a, rad, phase);
            case "花瓣"   -> rad * (0.66 + 0.34 * Math.abs(Math.cos(4 * (a + phase * 0.4))));
            case "齿轮"   -> rad * (0.88 + 0.12 * (Math.cos(12 * (a + phase)) > 0 ? 1 : 0));
            case "螺旋"   -> rad * (0.35 + 0.65 * mod(a + t * 0.8 + phase, TAU) / TAU);
            case "星轨"   -> rad * (1 + 0.03 * Math.sin(a * 24 + t * 4));
            default       -> rad;   // 圆：8 种动效模式都走这里
        };
    }

    /** 尖角数，用于顶点发光；螺旋/星轨/动效型为 0 */
    public static int tips(String mode) {
        return switch (mode) {
            case "五芒星" -> 5;
            case "六芒星", "六边形" -> 6;
            case "三角阵" -> 3;
            case "菱形" -> 2;
            case "花瓣" -> 8;
            case "齿轮" -> 12;
            default -> 0;
        };
    }

    /** pentagram 内接跳点：i -> (i+2)%n，仅五芒星/六芒星 */
    public static int nextTip(int i, int n) { return (i + 2) % n; }

    /** 采样一圈，返回半径数组；渲染与单测共用 */
    public static double[] sample(String mode, int segments, double rad, double t, double phase) {
        double[] out = new double[segments];
        for (int i = 0; i < segments; i++)
            out[i] = radius(mode, TAU * i / segments, rad, t, phase);
        return out;
    }

    /** 数一圈里的局部极大值个数，用来验证「五芒星恰好 5 尖」 */
    public static int localMaxima(double[] v) {
        int n = v.length, c = 0;
        for (int i = 0; i < n; i++) {
            double prev = v[(i - 1 + n) % n], cur = v[i], next = v[(i + 1) % n];
            if (cur > prev && cur >= next) c++;
        }
        return c;
    }
}
