import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          // For `text-primary-ink`: the accent where it has to be read rather
          // than looked at. `bg-primary text-primary-foreground` stays as it is.
          ink: "hsl(var(--primary-ink))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
          ink: "hsl(var(--destructive-ink))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
          ink: "hsl(var(--success-ink))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
          ink: "hsl(var(--warning-ink))",
        },
        panel: {
          DEFAULT: "hsl(var(--panel))",
          foreground: "hsl(var(--panel-foreground))",
        },
      },
      keyframes: {
        // Travels the full width of whatever it is placed on, so a wide cell
        // and a narrow one are swept at the same speed rather than in the same
        // time -- a row of them reads as one movement instead of several.
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.6s infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
