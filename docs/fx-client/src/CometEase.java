package com.bigpixel.comet.render;

/** 缓动。纯 Java。easeInOutCubic 对应 userscript 的 cmEase(11948)。 */
public final class CometEase {
    private CometEase() {}
    public static double clamp01(double x) { return x < 0 ? 0 : (x > 1 ? 1 : x); }

    public static double inOutCubic(double x) {
        x = clamp01(x);
        return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
    }
    public static double outCubic(double x) { x = clamp01(x); return 1 - Math.pow(1 - x, 3); }
    public static double inCubic(double x)  { x = clamp01(x); return x * x * x; }

    public static double outBack(double x) {
        x = clamp01(x);
        double c1 = 1.70158, c3 = c1 + 1;
        return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
    }
    public static double outElastic(double x) {
        x = clamp01(x);
        if (x == 0 || x == 1) return x;
        return Math.pow(2, -10 * x) * Math.sin((x * 10 - 0.75) * (2 * Math.PI / 3)) + 1;
    }

    /** 窗口函数：把 [start,end] 映射到 0..1，再做缓动 */
    public static double window(double p, double start, double end) {
        if (end <= start) return 0;
        return clamp01((p - start) / (end - start));
    }

    /** 开场动画四段：返回 veil / assemble / fadeOut / textAlpha */
    public static double[] introPhases(double p) {
        // 先钳制再参与乘法：1 - 1.0000000000000002 会留下 -2.2e-16 的负 alpha
        double fadeOut  = clamp01(1 - Math.max(0, (p - 0.82) / 0.18));
        double veil     = p < 0.08 ? p / 0.08 : (p > 0.86 ? fadeOut : 1);
        double assemble = inOutCubic(window(p, 0.10, 0.65));
        double textA    = clamp01(inOutCubic(window(p, 0.30, 0.50)) * fadeOut);
        return new double[]{ clamp01(veil), assemble, fadeOut, textA };
    }
}
