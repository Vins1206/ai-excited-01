# The First Dawn — ai-excited-01

One image, drawn from nothing but code: a lone explorer with a lantern on a
cliff at night, looking up at a colossal fire phoenix rising under aurora
ribbons and a full moon.

`main.ts` (Node 22, standard library only) paints the whole picture pixel by
pixel — sky gradient, aurora, moon, stars, the phoenix with its feathered
wings and trailing tail flames, embers, the cliff and the little lantern-lit
figure — then writes it out as a 1024×1024 PNG with a hand-rolled encoder
(CRC32, zlib deflate, per-row filter choice). Everything is seeded and
deterministic: two runs produce byte-identical files.

Run it:

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

Output: `out/entry.png` (1024×1024 PNG, well under the 1 MiB limit).
