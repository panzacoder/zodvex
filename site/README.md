# zodvex.dev (site)

The marketing site for [zodvex](https://github.com/panzacoder/zodvex). A static
[Astro](https://astro.build) site: one page, no client framework, Shiki-highlighted
code with per-line marks.

```bash
cd site
bun install
bun run dev      # http://localhost:4321/zodvex/
bun run build    # → site/dist
bun run preview
```

The site is **not** part of the root bun workspace on purpose — it has its own
lockfile so Astro's dependency tree never affects the library's install or CI.

## Where things live

- `src/data/scenarios.ts` — the side-by-side code samples (Convex · Convex + convex-helpers/zod · zodvex).
  Keep lines ≤ 74 characters so a snippet fits a half-width pane; `marks` are 1-based line numbers.
- `src/components/Compare.astro` — one scenario; the "compare against" switch is a
  `data-before` attribute on the section, so switching needs no per-scenario JS.
- `src/components/CodeBlock.astro` — Shiki via Astro's `<Code>` with dual themes.
- `src/pages/index.astro` — the page, including the boundary map table and quick start.
- `src/styles/global.css` — tokens for light/dark, Shiki theme switching, line highlights.

## Deploying

`.github/workflows/site.yml` builds `site/` on pushes to `main` that touch it and
deploys to GitHub Pages. `actions/configure-pages` supplies `SITE` and `BASE`, so the
build works at `https://panzacoder.github.io/zodvex/` today and on a custom domain
(where `BASE` becomes `/`) without config changes. Enable Pages with the
"GitHub Actions" source in the repository settings the first time.
