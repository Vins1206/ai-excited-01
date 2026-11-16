# The First Dawn — ai-excited-01

A single procedural painting, drawn pixel by pixel by `main.ts` (Node 22, standard library only, its own PNG encoder): a colossal phoenix of layered fire feathers spreads its wings across the whole night sky, turning its head toward a haloed full moon while aurora curtains ripple overhead. Far below, past streaming tail ribbons and drifting embers, a tiny explorer with a lantern stands on a black cliff above a sea that carries the phoenix's reflection — an extreme contrast of scale meant to hit in a single glance, and still read clearly at thumbnail size. The render is fully deterministic: one fixed seed, no clock, no network, so every run writes byte-identical output at 1024×1024.

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Vins1206/ai-excited-01/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Vins1206/ai-excited-01/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

Run it with `mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts` — the image lands in `out/entry.png`.
