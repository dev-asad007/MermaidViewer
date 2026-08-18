# Mermaid Studio

Mermaid Studio is a static, privacy-first Mermaid diagram editor. It runs entirely in the browser, needs no login or backend, and can be deployed to GitHub Pages.

## Features

- Live Mermaid rendering with clear syntax errors
- VS Code-style syntax coloring, autocomplete, bracket matching, search, lint markers, and fold gutters
- 13 built-in diagram templates
- A local project library for instantly switching, duplicating, and deleting browser projects
- Local `.mstudio` project files containing diagrams, comments, notes, and version history
- Direct folder access for `.mmd`, `.mermaid`, and `.txt` files in supported browsers
- Browser and connected-folder autosave, plus up to 100 manageable local snapshots
- Collapsible files and code panels for a full-page diagram canvas
- Local comment threads with resolve, reopen, and delete controls
- Undo, redo, code folding, command palette, zoom, pan, fit-to-view, fullscreen, light and dark themes
- High-resolution PNG and JPEG export at 1×, 2×, or 4×
- SVG, PDF, Mermaid source, Markdown, and private URL sharing
- Responsive desktop, tablet, and mobile interface
- SEO, Open Graph, X card, JSON-LD, sitemap, robots, manifest, and GitHub Pages workflow
- Crawlable guide, Mermaid examples, and privacy pages with unique titles, descriptions, canonical URLs, and structured data
- Automatic IndexNow notifications after successful GitHub Pages deployments

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

## Search indexing

The production site publishes four canonical, internally linked pages: the editor, product guide, Mermaid examples, and privacy policy. The sitemap lists every page and the deployment workflow notifies IndexNow after publishing.

Google does not provide an anonymous indexing API for general webpages. To request Google indexing and monitor results, verify the GitHub Pages URL in Google Search Console, submit `https://dev-asad007.github.io/MermaidViewer/sitemap.xml`, and inspect the canonical editor URL. Search inclusion and ranking are controlled by each search engine and are not guaranteed by metadata alone.

## Local folder support

Direct read/write folder access uses the File System Access API. It works on GitHub Pages over HTTPS in Chromium-based browsers. In other browsers, users can still open and save portable `.mstudio` project files and download all export formats.

## Privacy

Diagram source, notes, and version history remain in browser storage or in files the user explicitly opens. There is no account system, analytics, or backend service.

## Keyboard shortcuts

Shortcuts use `Cmd` on macOS and `Ctrl` on Windows/Linux.

- `Cmd/Ctrl + S`: save portable project
- `Cmd/Ctrl + O`: open a project
- `Cmd/Ctrl + N`: add a diagram
- `Cmd/Ctrl + B`: toggle the project sidebar
- `Cmd/Ctrl + J`: toggle the code editor
- `Cmd/Ctrl + F`: search inside code
- `Cmd/Ctrl + /`: toggle Mermaid line comments
- `Cmd/Ctrl + Shift + P`: command palette
- `F11`: fullscreen diagram
