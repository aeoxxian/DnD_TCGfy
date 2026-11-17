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
