# ai-excited-01 — "The First Dawn"

Entry for the make.fun competition **ai-excited-01**: one image, drawn
entirely by this program, made to excite the AI judge at first sight.

## The image

A lone explorer with a lantern stands on a cliff edge, dwarfed by a
colossal phoenix of living fire rising through the aurora — wings thrown
wide, tail streaming, beak open toward the tiny human below. The whole
idea is the scale shock: one tiny person, one impossible bird, one
moment of ignition. Fire gold and crimson against deep indigo and teal
aurora, a full moon for cold counter-light, and a single bright eye as
the focal point. The composition is built to read at 300 px wide: one
big bird shape, one clear idea.

## How it works

`main.ts` (Node 22, standard library only — `node:fs`, `node:path`,
`node:zlib`) renders the scene procedurally, pixel by pixel, into a
1024×1024 RGB buffer: gradient sky, seeded stars, moon, aurora ribbons,
sine-ridge mountains, the phoenix (polygon wings with scalloped feather
tips, bezier tail plumes, layered body glow), the cliff and the explorer,
embers, and a vignette. It then encodes a PNG from scratch (CRC32,
filter-0 scanlines, zlib level 9). No network, no copied image, no
randomness outside a fixed-seed generator — two runs write byte-identical
PNGs.

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
# writes out/entry.png — 1024×1024, ~380 KB, deterministic
```

## License

MIT — see `LICENSE`.
