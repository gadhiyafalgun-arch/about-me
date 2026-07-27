# Vendored libraries

Third-party libraries are committed here rather than loaded from a CDN. Two reasons:

1. **The old CDN URL was broken.** `index.html` previously loaded
   `cdn.jsdelivr.net/npm/three@0.162.0/build/three.min.js`. Three.js removed the UMD build in r161 —
   version 0.162.0 ships only `three.module.js` / `three.module.min.js`, so that URL returned 404 and
   `THREE` was never defined. The WebGL background silently did not run in production.
2. **A CDN outage must not break the site.** Section reveals are driven by GSAP. Serving the libraries
   from the same origin as the page removes that third-party dependency from the critical path.

All files are the official minified builds, copied unmodified from the npm registry.

| File | Package | Version | Source path in package |
|---|---|---|---|
| `three.module.min.js` | `three` | 0.185.1 | `build/three.module.min.js` |
| `three.core.min.js` | `three` | 0.185.1 | `build/three.core.min.js` |
| `gsap.min.js` | `gsap` | 3.12.5 | `dist/gsap.min.js` |
| `ScrollTrigger.min.js` | `gsap` | 3.12.5 | `dist/ScrollTrigger.min.js` |
| `lenis.min.js` | `lenis` | 1.1.18 | `dist/lenis.min.js` |

`three.module.min.js` imports `./three.core.min.js` by relative path, so the two Three files must stay
side by side in this directory.

`three` is resolved through the import map in `index.html`; the others attach globals (`gsap`,
`ScrollTrigger`, `Lenis`) and load as classic scripts.

## Updating

```sh
npm install three@<version> gsap@<version> lenis@<version>
cp node_modules/three/build/three.module.min.js vendor/
cp node_modules/three/build/three.core.min.js   vendor/
cp node_modules/gsap/dist/gsap.min.js           vendor/
cp node_modules/gsap/dist/ScrollTrigger.min.js  vendor/
cp node_modules/lenis/dist/lenis.min.js         vendor/
```

Then update the version column above. There is no build step — the site is served as plain static files.
