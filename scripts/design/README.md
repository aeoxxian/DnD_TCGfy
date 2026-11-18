# Play-mat material generators

These scripts produced the images in `src/assets/playmat/`. They are not part of the app build and need Python 3 with `numpy` and `Pillow`. Run them only when you want to change a material.

| Script | Output |
| --- | --- |
| `textures.py <out>` | `leather-grain.png` (seamless grain overlay) and `parchment.png` (seamless parchment). The `deckle.txt` polygon becomes the `--deckle` clip-path in `src/theme-playmat.css`. |
| `ornaments.py <out>` | `arcane-circle.svg` and the `card-back.svg` crest back (saved in the app as `back-crest.svg`). |
| `ornaments2.py <out>` | Corner-only metal frames (`frame-corners-gold.svg`, `frame-corners-silver.svg`), coins, gems, the socket and `card-back-stars.svg`. |
| `waxseal.py <out.png>` | `wax-seal.png`, shaded from a height map. |
| `emblem.py <source> <out>` | The metal logo cards and the dragon card back, made from `docs/design/playmat/dragon-source.webp` (supplied by the user). |

SVGs that use lighting filters (the frames, logos and card backs) were rasterised to PNG with sharp at 2× (frames 480 px, logos 132 px, card backs 480 px wide) so they look the same in every renderer. Example:

```js
await sharp('frame-corners-gold.svg', { density: 600 }).resize({ width: 480 }).png().toFile('frame-gold.png');
```

The frame image is used as a 9-slice: `border-image: url(frame-gold.png) 120 / 64px stretch`. Only the 120 px corners are decorated; the edges are two plain rails.

## v1.2 Phase 3 (per-theme materials and ornaments)

| Script | Output |
| --- | --- |
| `python materials_v12.py <out>` | Seamless 512 px tiles: `felt-grain.png` (숲의 펠트), `wood-grain.png` (흑단과 은), `stone-grain.png` (아케인 블루) as RGBA overlays like `leather-grain.png`, plus the page tiles `paper.png` and `stone-light.png`. Also writes `materials-preview.png`. |
| `node frames_v12.mjs <out>` | Board frames `frame-{oxblood,ebony,felt,arcane}.png` (240-unit 9-slice → 480 px, 60-unit corners) and page corners `panel-{oxblood,ebony,felt,arcane}.png` (160-unit 9-slice → 320 px, 40-unit corners). Set `FRAMES_SVG=1` to also keep the SVG sources. |

The frames are used with `border-image: var(--frame-img) 120 / 64px round` (board) and `var(--panel-img) 80 / 30px round` (ledger and card page). The edges hold only lines and details whose period divides the edge slice, so `round` tiles them seamlessly; the band's material is the element's own textured background. Every filter uses `filterUnits="userSpaceOnUse"` and straight strokes use user-space gradients, because a horizontal line has a zero-height bounding box (the effect would otherwise disappear). `frame-gold.png` and `frame-silver.png` are the v1.1 frames, no longer referenced.

## v1.2 Phase 4 (bookmarks and recovery tokens)

| Script | Output |
| --- | --- |
| `node tokens_v12.mjs <out> [preview_dir]` | Vector SVGs: recovery tokens `rest-{oxblood,ebony,felt,arcane}.svg` (96 units, shown at 44/38 px) and card-page bookmarks `bookmark-{oxblood,ebony,felt,arcane}.svg` (40×100 units, shown at 20×50 px). Each root `<svg>` carries `id="<file name>"` so it can be recognised when Vite inlines it as a data URI. With a preview dir it also writes 4× PNG previews. |

The theme blocks in `src/theme-playmat.css` point `--rest-token`, `--rest-icon`, `--rest-icon-shadow` and `--bookmark` at them; `tests/V12ThemeAssets.test.ts` checks the wiring and that the SVGs are self-contained.
