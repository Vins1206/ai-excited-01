# The First Dawn — ai-excited-01

A colossal phoenix fills the whole sky at the moment of first dawn. Its wings
stretch edge to edge, built from hundreds of individually drawn flame feathers
that grade from white-hot at the root through gold and orange to deep red at
the tips. The bird turns its head toward a large haloed full moon while vivid
green-and-violet aurora curtains ripple across a star field above it. A long
tail of fire streams down toward a thin strip of sea that mirrors the flames
in broken streaks of light, and on a dark cliff below, a tiny explorer with a
lantern watches — a deliberate, extreme contrast of scale.

Everything is procedural: a single Node 22 program using only the standard
library renders the scene into a float framebuffer (layered feather fans,
additive glows, a seeded star field, aurora ribbons, ember particles, cliff
silhouettes and water reflections), tone-maps it, and encodes a deterministic
1024×1024 PNG with its own PNG writer. Two runs produce byte-identical output.

Run it with:

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Vins1206/ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Vins1206/ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
