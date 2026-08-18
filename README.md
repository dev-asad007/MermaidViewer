# Mermaid Studio

Mermaid Studio is a static, privacy-first Mermaid diagram editor. It runs entirely in the browser, needs no login or backend, and can be deployed to GitHub Pages.

## Features

- Live Mermaid rendering with clear syntax errors
- 13 built-in diagram templates
- Local `.mstudio` project files containing diagrams, notes, and version history
- Direct folder access for `.mmd`, `.mermaid`, and `.txt` files in supported browsers
- Browser autosave and up to 30 local snapshots
- Undo, redo, search, zoom, pan, fit-to-view, fullscreen, light and dark themes
- High-resolution PNG and JPEG export at 1×, 2×, or 4×
- SVG, PDF, Mermaid source, Markdown, and private URL sharing
- Responsive desktop, tablet, and mobile interface
- SEO, Open Graph, X card, JSON-LD, sitemap, robots, manifest, and GitHub Pages workflow

## Run locally

```bash
pnpm install
pnpm run dev
```

Create a production build with:

```bash
pnpm run build
```

The finished static site is written to `dist/`.

## Deploy to GitHub Pages

1. Push the project to a GitHub repository whose default branch is `main`.
2. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
3. Push a commit to `main`; the included workflow builds and publishes the site.

The included metadata is configured for `https://dev-asad007.github.io/MermaidViewer/`. Update the URL in `index.html`, `public/robots.txt`, and `public/sitemap.xml` if the repository name or domain changes.

## Local folder support

Direct read/write folder access uses the File System Access API. It works on GitHub Pages over HTTPS in Chromium-based browsers. In other browsers, users can still open and save portable `.mstudio` project files and download all export formats.

## Privacy

Diagram source, notes, and version history remain in browser storage or in files the user explicitly opens. There is no account system, analytics, or backend service.
