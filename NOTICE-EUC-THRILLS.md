# EUC Thrills notice (carried with this fork)

This fork (*euc-newyork*) contains code and original assets from *EUC Thrills*. Its notice requires the origin and
copyright below to travel with every copy. The sections between the rules are copied **verbatim** from
`NOTICE.md` at [VibezZzCoder/EUC-thrills@5f45fff](https://github.com/VibezZzCoder/EUC-thrills/blob/5f45fff19b258e140833841ba2473069af751a12/NOTICE.md);
read that file for the complete notice. The MIT licence text is in `js/euc/LICENSE`.

---

## Origin

*EUC Thrills* is an original work by **VibezZzCoder** — <https://github.com/VibezZzCoder>.

| | |
|---|---|
| Source | <https://github.com/VibezZzCoder/EUC-thrills> |
| Play | <https://vibezzzcoder.github.io/EUC-thrills/> |
| Devlogs | [@EdwinRodMen on YouTube](https://www.youtube.com/@EdwinRodMen) |
| Copyright | © 2026 VibezZzCoder |

The same origin is carried inside the build itself — as a banner at the top of the bundled script, as `author`, `canonical`, and `code-repository` metadata in the page, and as one line printed to the browser console at startup — so that a copy of the published files still says where it came from.

**Forking is welcome.** That is what the MIT licence is for, and no permission needs to be asked. What the licence does require of every copy, including a fork that renames the game, is that this notice and the copyright line above travel with it. Presenting this work, or a lightly modified version of it, as an original creation is a licence violation regardless of how automated the copying was.

## Licensing

**Source code** in this project is released under the MIT License. See `LICENSE`.

**Original game assets** authored for this project — 3D models, textures, materials, procedurally generated geometry and audio, and UI art — are released under
[Creative Commons Attribution 4.0 International (CC BY 4.0)](https://creativecommons.org/licenses/by/4.0/).

The two licences are stated separately on purpose: MIT is a software licence and does not read sensibly when applied to models, textures, and sound. If you reuse one but not the other, the terms are unambiguous.

### Riders reused here

The Cool Rider character model and design are original work. **His riding clothes and style are based on what the project owner wears**, and the owner rides and posts publicly on Instagram as [@edwin_rodmen](https://www.instagram.com/edwin_rodmen/); the link is listed here as the style-inspiration credit at his direction. The character does not reproduce the owner's face, and “Cool Rider” is a fictional character name rather than the owner's public name or nickname. The character name is an affectionate nod to a song title; no association with its rights holders is claimed or implied.

The second rider, "Trollina", is also an original creation. She began as a crude joke drawing sent to the project owner, which he owns and kept; the character in the game is original geometry authored from that concept and is covered by the CC BY 4.0 claim above. The original drawing itself is held privately under `references/` and is not redistributed.

## Attribution

If you use this project's original assets under CC BY 4.0, attribute as:

> Assets from *EUC Thrills* by VibezZzCoder — CC BY 4.0 — https://github.com/VibezZzCoder/EUC-thrills

---

## What this fork took, and what it changed

- **Code (MIT):** the EUC controller and its simulation helpers, `PlanTerrainSampler`, the input action types, the
  chase-camera maths and the rider/wheel rig (`js/euc/`, converted from TypeScript by `tools/vendor-euc.mjs`; each file
  names its source and `js/euc/MANIFEST.json` records the commit and source hashes). Comments were removed by the
  conversion; the upstream source is the documentation.
- **Original assets (CC BY 4.0):** the procedural looks of Cool Rider, Trollina and Officer Dorkins (the cop; kept for
  a future chasing character, not playable), and the standard wheel and Trollina's livery of it. Assets from
  *EUC Thrills* by VibezZzCoder — CC BY 4.0 — https://github.com/VibezZzCoder/EUC-thrills
- **Audio** (`audio/euc/`, byte-for-byte copies; sources, hashes and licences in `audio/euc/PROVENANCE.md`):
  - `crash_wipeout.wav` (Cool Rider's crash; the owner's own recording), `overspeed_beep.wav` and `tyre_solid_loop.wav`
    (synthesised for the project): CC BY 4.0.
  - `crash_trollina.wav` (Trollina's crash): its synthesised layers are CC BY 4.0; **its vocal layer is
    machine-generated (TTS) and is not covered by CC BY 4.0.** It is included by the owner's choice.
  - `wind_howl_loop.wav`: Freesound #117611 by swiftoid, CC0.
  - The wheel's motor, hop, landing, kerb-strike and recovery sounds are new code written for this fork
    (`js/euc-audio.js`), not copied.
- **Modified:** `render/riderLook.ts` and `render/machineLook.ts` are cut down to those riders and machines;
  `data/tuning.ts` loses the colour entries of riders who are not included. The fork's own code
  (`js/euc-rider.js`, `js/euc-terrain.js`, `js/euc-dynamic.js`, `js/euc-audio.js`) adapts the controller to New York:
  the city's ground, buildings and street furniture, and its cars and pedestrians as moving obstacles. The wheel keeps
  the stock tuning, so Manhattan's 0.22 m curbs must be hopped.
- **Not included:** every real-person rider, their looks, machines, logos and recordings (including every other crash
  sample); The Drunkard; the game modes, levels, menus and the built game in upstream `docs/`. No licence here covers
  anything that is not included, and nothing in this fork implies endorsement by any rider.
