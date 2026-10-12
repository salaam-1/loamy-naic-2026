import type { Config } from 'tailwindcss'
import defaultTheme from 'tailwindcss/defaultTheme'
import plugin from 'tailwindcss/plugin'

/**
 * Loamy design tokens.
 *
 * LOCKED BRAND (do not change): Emerald #014D40 primary, Gold #C8A045 accent.
 *
 * STYLE DIRECTION (2026-09-20). The previous rules here were a deliberate
 * "pro dev register" choice: radius hard-capped at 4px, every shadow resolved
 * to `none`, borders doing all the separation. That made Loamy read as a
 * competent admin tool. The product direction is now a premium agricultural
 * operating system -- consumer-grade warmth over enterprise infrastructure --
 * so the flat rules are replaced, on purpose and with the brand colours
 * untouched:
 *
 *   - a real radius scale, because a 4px card cannot feel premium;
 *   - three restrained elevation steps, tinted with the soil hue rather than
 *     neutral black, so a raised surface looks lit rather than dirty;
 *   - warm neutral surfaces (bone / sand / clay) replacing cool grey-white.
 *     Agricultural products live on paper, grain and soil, not on #FFFFFF.
 *   - a LAYERED environment rather than coloured rectangles on a background:
 *     barely-perceptible tonal gradients, translucency with backdrop blur,
 *     and a low-contrast grain. Depth comes from how surfaces sit in light,
 *     not from giving each one a different fill. A solid block of colour is
 *     the one thing this system is trying not to be.
 *
 * WHAT DID NOT CHANGE
 *   - Emerald and Gold, to the hex.
 *   - Inter for UI, JetBrains Mono for figures. Money and quantities have to
 *     be scannable in a column, which proportional digits are not.
 *   - 150ms as the default transition. Motion communicates state; it is not
 *     decoration.
 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    /**
     * Radius scale. `card` is the one most surfaces should use; `control` is
     * for buttons and inputs, which look wrong at card radius. `pill` is for
     * badges and status chips, `full` stays reserved for avatars and dots.
     */
    borderRadius: {
      none: '0px',
      sm: '6px',
      DEFAULT: '10px',
      control: '10px',
      md: '10px',
      lg: '14px',
      card: '16px',
      xl: '20px',
      '2xl': '24px',
      '3xl': '28px',
      pill: '999px',
      full: '9999px',
    },
    /**
     * Elevation. Tinted with the deep soil hue (20,30,25) rather than pure
     * black: a neutral-black shadow over a warm surface reads as grime.
     * Three steps only -- `sm` for resting cards, `md` for hover and popovers,
     * `lg` for modals and drawers. Anything heavier is decoration.
     */
    boxShadow: {
      none: 'none',
      sm: '0 1px 2px 0 rgba(20, 30, 25, 0.05)',
      DEFAULT: '0 1px 2px 0 rgba(20, 30, 25, 0.05)',
      card: '0 1px 2px 0 rgba(20, 30, 25, 0.05)',
      md: '0 2px 8px -1px rgba(20, 30, 25, 0.06), 0 1px 3px -1px rgba(20, 30, 25, 0.04)',
      'card-hover': '0 2px 8px -1px rgba(20, 30, 25, 0.06), 0 1px 3px -1px rgba(20, 30, 25, 0.04)',
      lg: '0 8px 24px -4px rgba(20, 30, 25, 0.08), 0 2px 8px -2px rgba(20, 30, 25, 0.05)',
      xl: '0 8px 24px -4px rgba(20, 30, 25, 0.08), 0 2px 8px -2px rgba(20, 30, 25, 0.05)',
      '2xl': '0 8px 24px -4px rgba(20, 30, 25, 0.08), 0 2px 8px -2px rgba(20, 30, 25, 0.05)',
      inner: 'inset 0 1px 2px 0 rgba(20, 30, 25, 0.04)',
    },
    extend: {
      /**
       * Touch target, in real pixels.
       *
       * WHY THIS IS NOT `11` OR `12`
       *   The root font is 15px (see src/index.css), a deliberate density
       *   choice. Every rem-based Tailwind size is therefore multiplied by
       *   0.9375, so `min-h-11` renders at 41.25px and silently misses the
       *   44px touch target. That is how the language selector shipped at
       *   41px: the class was right and the arithmetic was not.
       *
       *   `touch` is an absolute 44px and cannot drift with the root font.
       *   Use `min-h-touch` (and `min-w-touch` for icon-only controls) on
       *   anything a finger is meant to hit. It feeds every spacing utility,
       *   so `size-touch` and `h-touch` work too.
       *
       *   It is a MINIMUM, not a height: applying it to a control that is
       *   already taller changes nothing, which is why it is safe to add to
       *   a desktop-sized button without distorting the layout.
       */
      spacing: {
        touch: '44px',
      },
      colors: {
        emerald: {
          50: '#EEF6F3',
          100: '#DCEDE7',
          200: '#B5DACD',
          300: '#84C0AC',
          400: '#4C9F85',
          500: '#1E8066',
          600: '#0E6B54',
          700: '#0A5A47',
          800: '#014D40', // Loamy primary — LOCKED
          900: '#0B3D2E', // sidebar deep — LOCKED
          950: '#062B20',
        },
        gold: {
          50: '#FBF7EC',
          100: '#F5EBD4',
          200: '#EAD6A5',
          300: '#DDBE72',
          400: '#C8A045', // Loamy luxury gold — LOCKED
          500: '#B08935',
          600: '#8F6E2A',
          700: '#6E5420',
        },

        /**
         * Warm neutrals. Named after what they are made of, not after a
         * lightness number, so a later change of value does not make the name
         * a lie.
         */
        bone: '#FBF9F4', // page background — paper, not white
        sand: '#F4EFE6', // raised panel, inset row, selected state
        clay: '#E8E0D2', // borders and dividers on warm surfaces
        bark: '#3E3A32', // warm dark text where emerald would be too cold

        // `surface` and `line` are kept as aliases so ~128 existing pages
        // keep working; both now resolve to the warm palette.
        surface: '#FBF9F4',
        line: '#E8E0D2',
      },
      fontFamily: {
        sans: ['Inter', ...defaultTheme.fontFamily.sans],
        mono: ['"JetBrains Mono"', ...defaultTheme.fontFamily.mono],
      },
      fontSize: {
        // Editorial display sizes for the few real product moments. Tight
        // leading and negative tracking, which large Inter needs.
        'display-lg': ['2.5rem', { lineHeight: '1.08', letterSpacing: '-0.025em', fontWeight: '700' }],
        display: ['2rem', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '700' }],
        'display-sm': ['1.5rem', { lineHeight: '1.18', letterSpacing: '-0.015em', fontWeight: '700' }],
      },
      /**
       * Environment gradients. Every one of these is a two-to-four percent
       * tonal shift -- if a gradient is noticeable as a gradient, it is
       * wrong. They exist so a large surface has somewhere for light to come
       * from, not to be seen.
       */
      backgroundImage: {
        'env-page': 'linear-gradient(175deg, #FCFAF6 0%, #F7F3EA 55%, #F2EDE2 100%)',
        'env-sage': 'linear-gradient(170deg, #F8F6F0 0%, #F0F2EB 100%)',
        'env-panel': 'linear-gradient(180deg, rgba(255,255,255,0.92) 0%, rgba(251,249,244,0.88) 100%)',
        // Primary action: a 6% vertical shift so the fill reads as a lit
        // surface rather than a printed rectangle.
        'brand-fill': 'linear-gradient(180deg, #0A5A47 0%, #014D40 100%)',
        'brand-fill-hover': 'linear-gradient(180deg, #0E6B54 0%, #0A5A47 100%)',
        'gold-fill': 'linear-gradient(180deg, #D4AE59 0%, #C8A045 100%)',
        // Scrim for photography. Bottom-weighted so text sits in the dark
        // part and the top of the image stays readable as an image.
        // Hero scrim. The first version started fully transparent at 25% and
        // only darkened near the bottom, which was fine over a dim photo and
        // illegible over a bright one -- sunlit foliage washed the title out
        // completely. It now carries a floor across the whole panel and
        // deepens toward the text, which is measured rather than assumed:
        // scripts/visual-qa-home.mjs samples the pixels behind the heading
        // and asserts a contrast ratio of at least 4.5:1.
        'image-scrim': 'linear-gradient(180deg, rgba(6,43,32,0.46) 0%, rgba(6,43,32,0.68) 40%, rgba(6,43,32,0.86) 100%)',
        'image-scrim-soft': 'linear-gradient(180deg, rgba(6,43,32,0.05) 0%, rgba(6,43,32,0.38) 100%)',
        // For bright photographs. hero-farmer.jpg is sunlit foliage and sat at
        // 3.9:1 under the standard scrim; the same scrim gave 6.7:1 over the
        // darker market photo. Strength is per image because brightness is a
        // property of the photograph, not of the layout.
        'image-scrim-strong': 'linear-gradient(180deg, rgba(6,43,32,0.58) 0%, rgba(6,43,32,0.76) 40%, rgba(6,43,32,0.9) 100%)',
      },
      backdropBlur: {
        panel: '12px',
      },
      transitionDuration: {
        DEFAULT: '150ms',
      },
      transitionTimingFunction: {
        // One easing for everything that enters or grows. Decelerating motion
        // reads as a thing arriving rather than a thing being thrown.
        out: 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        'rise-in': {
          from: { opacity: '0', transform: 'translateY(6px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'slide-up': {
          from: { transform: 'translateY(100%)' },
          to: { transform: 'translateY(0)' },
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' },
        },
        // Acknowledges a successful add-to-cart on the cart icon itself.
        // One short rise and settle -- no bounce-back overshoot, which reads
        // as playful rather than assured.
        'cart-bump': {
          '0%, 100%': { transform: 'scale(1)' },
          '35%': { transform: 'scale(1.18)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 150ms cubic-bezier(0.16, 1, 0.3, 1)',
        'rise-in': 'rise-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-up': 'slide-up 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        shimmer: 'shimmer 1.6s infinite',
        'cart-bump': 'cart-bump 320ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [
    /**
     * `touch-target`: the canonical hit area for a control that is TEXT.
     *
     * WHY A UTILITY AND NOT JUST `min-h-touch`
     *   `min-height` does nothing at all on an inline element, and a link is
     *   inline by default. The idiom this replaces was written by hand in
     *   several places as `-my-2 py-2` -- negative margin cancelling padding
     *   that was meant to grow the hit area -- and it lands at 34px every
     *   time, because vertical padding on an inline box does not grow it.
     *   The class looked deliberate, so it was never re-measured.
     *
     *   This sets the display mode AND the minimum together, so the minimum
     *   can actually take effect. On a control that is ALREADY flex the
     *   display mode is redundant and `min-h-touch` (plus `min-w-touch` when
     *   it is icon-only) is the right choice instead.
     *
     *   `touch-target-sq` is the icon-only variant: square, both axes, and
     *   centred, which is the shape every icon button in the shell wants.
     */
    plugin(({ addUtilities }) => {
      addUtilities({
        '.touch-target': {
          display: 'inline-flex',
          alignItems: 'center',
          minHeight: '44px',
        },
        '.touch-target-sq': {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '44px',
          minWidth: '44px',
        },
      })
    }),
  ],
} satisfies Config
