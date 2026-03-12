# GATE Geometry Viewer

Browser-based 3D geometry visualizer for OpenGATE simulation scripts. No Python or GATE installation needed.

## Features

- Paste a URL to a raw Python GATE simulation script (or paste the script text directly)
- Parses the script client-side using regex + simple expression evaluation
- Extracts volumes (Box/Sphere), sources, materials, and GATE unit definitions
- Renders 3D geometry with Three.js + OrbitControls
- Computes ray-traced attenuation images using Beer-Lambert law with energy-dependent linear attenuation coefficients at 662 keV
- Displays attenuation image as a texture on the detector face
- Toggle button to show/hide the light projection

## Usage

Deploy via GitHub Pages from root, or serve locally:

```
python -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

## Architecture

- `index.html` — Single-page app with dark theme UI
- `js/parser.js` — Regex-based GATE script parser (extracts volumes, sources, units)
- `js/raytracer.js` — Vectorized ray tracer (slab method for boxes, quadratic for spheres)
- `js/materials.js` — Material database (linear attenuation coefficients at 662 keV)
- `js/app.js` — Three.js scene, UI wiring, projection rendering
