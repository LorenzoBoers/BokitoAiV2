# AI robo.lottie (reference)

Source: `ai-robo.lottie` (dotLottie v2 with `StateMachine1`).

Not played at runtime — Bokito agents keep SVG `BotOrbAvatar` + shape/color.
Timings and state names are stolen into `src/lib/bot-orb-motion.ts`.

## Markers @ 60fps (Main Scene, 700×700, op=480)

| Segment   | Start | Duration | ~ms  | Product map      |
|-----------|-------|----------|------|------------------|
| idle      | 0     | 29       | 483  | idle breathe     |
| yes       | 31    | 74       | 1233 | approve one-shot |
| no        | 106   | 74       | 1233 | reject one-shot  |
| alert     | 181   | 89       | 1483 | error one-shot   |
| thinking  | 271   | 119      | 1983 | thinking loop    |
| jump      | 391   | 88       | 1467 | wake / celebrate |

## Layers

- `outer` — rotation (working/thinking ring)
- `inner` / `inner 2` — shape fills (not ported; we keep agent silhouettes)
- `load` — opacity/pos/scale (thinking/typing arc)
- `Cross` — opacity (alert flash)

Demo click layers (YES/NO/ALERT/THINK/JUMP) are ignored in product.
