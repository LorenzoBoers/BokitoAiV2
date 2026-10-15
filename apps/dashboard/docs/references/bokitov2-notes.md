# bokitov2.svg → bot orb shape `bokito`

Source art: `bokitov2.svg` (viewBox 582×494).

Mapped into `bot-orb-shapes.ts` as shape key **`bokito`** (64×64):

| Source layer | Fill in art | Orb layer |
|--------------|-------------|-----------|
| Left/right outer ears | `#8600FB` | `underPath` |
| Left/right inner ears | `#7A00E5` | `shadePath` |
| Head + chin ellipses | `#8600FB` | `path` (eye clip) |
| Nostrils | `#7A00E5` | `detailPath` (on top of body) |
| Gray eye capsules | `#D9D9D9` | **omitted** — `BotOrbAvatar` draws live white eyes |

Runtime tint uses the agent's `avatar_color` (not the source purple). Transform: uniform scale ~0.100 into a 64×64 box with ~3u margin; `faceY: -5.5`, `faceScale: 0.92` to align eyes with the source sockets.
