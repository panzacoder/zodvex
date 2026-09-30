// @ts-check
import { defineConfig } from 'astro/config'

// The GitHub Pages workflow (.github/workflows/site.yml) passes SITE and BASE
// from actions/configure-pages so the same build works on a project page
// (https://panzacoder.github.io/zodvex) or a custom domain (BASE="/").
const site = process.env.SITE || 'https://panzacoder.github.io'
const base = process.env.BASE || '/zodvex'

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: { format: 'directory' },
})
