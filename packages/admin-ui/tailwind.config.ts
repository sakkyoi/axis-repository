import type { Config } from "tailwindcss";

export default {
  content: {
    relative: true,
    files: ["./index.html", "./src/**/*.{ts,tsx}"],
  },
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
          // For `text-primary-ink` and `bg-primary-ink/10`: the accent where it
          // has to be read rather than looked at, and the faint wash of it that
          // marks a chosen row. `bg-primary text-primary-foreground` stays as
          // it is.
          //
          // Opacities on a nested shade come from the theme's own scale: `/10`
          // is generated, an off-scale `/12` is not generated at all, and the
          // class then lands on the element and paints nothing -- no build
          // warning, and nothing in the markup to say so.
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
