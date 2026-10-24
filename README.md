# NYC Spin-off: EUC Thrills (work in progress)

Ride an electric unicycle through a living 3D Manhattan: hop the kerbs, carve through traffic, mind the crowds.
A free side project of [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder. The riding
(the wheel's physics, the riders and the crashes) comes from *EUC Thrills*. The city is a fork of Mr.doob's
open-source [three.js New York](https://github.com/mrdoob/slop-newyork) (MIT); it is not meant to merge back.

Status: early. Riders: Cool Rider (`1`) and Trollina (`2`). Cars, buses and pedestrians are solid: hitting one at
speed is a crash. Real-world brands are replaced with fictional ones. Street, park and landmark names are kept as
place names.

## Run it

No build step. Serve the folder and open it in a browser with WebGPU (current Chrome or Edge):

```bash
python3 -m http.server 8000 --bind 127.0.0.1
# then open http://127.0.0.1:8000
```

Controls:

| | Keyboard | Gamepad (Xbox layout) |
|---|---|---|
| Lean forward / back | `W` / `S` | RT / LT, or left stick |
| Carve | `A` / `D` | Left stick |
| Hop (kerbs!) | `Space` | A |
| Crouch | `Shift` | X |
| Get up after a crash | `R` | B |
| Rider | `1` / `2` | LB / RB |
| Camera | `V`, `5`–`0` | Y; right stick orbits |
| Map | `M` | Start |

The on-screen hints switch to gamepad buttons as soon as a pad is used. `?rider=trollina` in the URL picks a rider.
The [player guide](PLAYER_GUIDE.md) has everything else: how the wheel rides, crashes, the city and every control.

On a phone or tablet the controls are *EUC Thrills*' own. Put your left thumb down anywhere in the bottom-left and a
stick appears under it: push up to lean forward, down to brake, sideways to carve. HOP and CHARGE (crouch for a bigger
hop) sit under the right thumb, and GET UP appears there after a crash. Drag anywhere else to look around and pinch
to zoom. Portrait and landscape both work.

The speed shows in mph and km/h. When the wheel works hard, tilts back or nears its top speed, a warning appears
above the gauge. Central Park sits behind its wall: ride in by one of its gates (the real entrances, such as 6th Ave
or 7th Ave at 59th St, or 5th Ave at 72nd or 90th St).

## Developing

- `node --test tests/*.test.*` runs the headless tests (Node 18 or newer).
- `js/euc/` is generated. Do not edit it. To update it from a local EUC Thrills checkout (`npm ci` done there), run
  `node tools/vendor-euc.mjs --src <path-to-EUC-thrills>`. Run it with `--check` to
  confirm the folder is current. The tool only keeps the riders in scope, and it fails if anything from a real-person
  rider reaches the output.
- three.js is pinned to one commit in `index.html`'s import map.

## License and data

- Code: [MIT License](LICENSE). The city (Slop New York) © 2026 Mr.doob; the EUC spin-off's own code (riding the
  city, the HUD, touch controls, sound, the park gates) © 2026 VibezZzCoder. Keep both copyright lines in every copy.
- *EUC Thrills* code: MIT, © 2026 VibezZzCoder (`js/euc/LICENSE`). Rider and wheel assets: CC BY 4.0. Assets from
  *EUC Thrills* by VibezZzCoder — CC BY 4.0 — https://github.com/VibezZzCoder/EUC-thrills. See
  [NOTICE-EUC-THRILLS.md](NOTICE-EUC-THRILLS.md), which must travel with every copy. Audio files and their licences
  are listed in [audio/euc/PROVENANCE.md](audio/euc/PROVENANCE.md). Trollina's crash vocal is machine-generated and is
  not covered by CC BY 4.0.
- Geographic data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
  The OpenStreetMap-derived parts of `js/nyc-geodata.js` are a derivative database under the ODbL and stay openly
  available in this repository. These credits are also shown in the game, on the full map (`M`).
- three.js (MIT) and the Inter and Overpass fonts (SIL OFL) load from jsDelivr and Google Fonts. Third-party data and
  dependencies keep their own licenses.

This project is not affiliated with or endorsed by Mr.doob, any rider, or any manufacturer or brand.
