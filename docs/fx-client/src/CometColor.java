package com.bigpixel.comet.render;

/** 颜色工具。纯 Java。落到 Meteor 时用 new Color(r,g,b,a) 包装返回值。 */
public final class CometColor {
    private CometColor() {}

    /** h∈[0,360), s,v∈[0,1] → {r,g,b}，各 0..255 */
    public static int[] hsv(double h, double s, double v) {
        double hh = ((h % 360) + 360) % 360;
        int i = (int) (hh / 60) % 6;
        double f = hh / 60 - (int) (hh / 60);
        double p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
        double r, g, b;
        switch (i) {
            case 0 -> { r = v; g = t; b = p; }
            case 1 -> { r = q; g = v; b = p; }
            case 2 -> { r = p; g = v; b = t; }
            case 3 -> { r = p; g = q; b = v; }
            case 4 -> { r = t; g = p; b = v; }
            default -> { r = v; g = p; b = q; }
        }
        return new int[]{ (int) Math.round(r * 255), (int) Math.round(g * 255), (int) Math.round(b * 255) };
    }

    /** 彩虹流动：t 秒驱动色相，phase 让每个顶点错开；返回 0xAARRGGBB */
    public static int rainbow(double t, double phase, int alpha) {
        int[] rgb = hsv((t * 55 + phase * 360 / (Math.PI * 2)) % 360, 0.85, 0.95);
        return pack(alpha, rgb[0], rgb[1], rgb[2]);
    }

    public static int pack(int a, int r, int g, int b) {
        return ((a & 255) << 24) | ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
    }
    public static int alpha(int argb) { return (argb >>> 24) & 255; }
    public static int red(int argb)   { return (argb >>> 16) & 255; }
    public static int green(int argb) { return (argb >>> 8) & 255; }
    public static int blue(int argb)  { return argb & 255; }

    /** 线性插值两个 0xAARRGGBB */
    public static int lerp(int a, int b, float f) {
        float k = Math.max(0, Math.min(1, f));
        return pack(
            (int) (alpha(a) + (alpha(b) - alpha(a)) * k),
            (int) (red(a)   + (red(b)   - red(a)) * k),
            (int) (green(a) + (green(b) - green(a)) * k),
            (int) (blue(a)  + (blue(b)  - blue(a)) * k));
    }

    /** 血量色：绿 → 黄 → 红 */
    public static int healthColor(float ratio, int alpha) {
        float k = Math.max(0, Math.min(1, ratio));
        int r = (int) (255 * (k < 0.5 ? 1 : 2 - 2 * k));
        int g = (int) (255 * (k < 0.5 ? 2 * k : 1));
        return pack(alpha, r, g, 40);
    }

    /** 把 #RRGGBB 或 #RGB 解析成 0xAARRGGBB */
    public static int fromHex(String hex, int alpha) {
        String h = hex == null ? "" : hex.replace("#", "");
        if (h.length() == 3) {
            StringBuilder sb = new StringBuilder();
            for (char c : h.toCharArray()) sb.append(c).append(c);
            h = sb.toString();
        }
        while (h.length() < 6) h += "0";
        try {
            int n = Integer.parseInt(h.substring(0, 6), 16);
            return pack(alpha, (n >> 16) & 255, (n >> 8) & 255, n & 255);
        } catch (NumberFormatException e) {
            return pack(alpha, 176, 107, 255);
        }
    }
}
