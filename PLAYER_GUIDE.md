# NYC Spin-off: EUC Thrills — player guide

The long version of the [README](README.md): how the wheel rides, the city, every control, and what the game saves.
The riding comes from [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder; the city is a fork
of Mr.doob's three.js New York.

## What you need

A browser with WebGPU: current Chrome or Edge on a desktop or laptop, or a recent Chrome on Android. A gamepad and a touch
screen both work. Sound starts after your first click, key or tap.

## Starting

After loading, the title screen shows the city with your rider in it. Pick **Cool Rider** or **Trollina**, then
press **Ride** (or Enter, or A on a gamepad). You can still change rider at any time while riding.

## Riding

You ride an electric unicycle through Manhattan, from the Battery to Harlem. A few things are specific to a real
wheel and worth knowing before they surprise you:

- **You lean to go.** Leaning forward accelerates, leaning back brakes, and holding back from a standstill rolls you
  backwards. Carving is leaning into the turn: the faster you go, the wider the line.
- **Kerbs must be hopped.** Manhattan's kerbs are 22 cm, a fraction more than the wheel can climb on its own. Roll
  into one slowly and you stop at its face; hit one at speed (about 8 mph / 13 km/h or more) and you go over the
  front. Hop just before it.
- **Crouch charges the hop.** Hold crouch for a moment, then hop, for a jump about 40% higher.
- **The wheel tells you when it is working hard.** Riding fast, accelerating hard, climbing and heavy landings all
  load it. A warning shows above the speed: *Working hard*, then *Ease off*. Push further and the wheel **tilts
  back**: it lifts its nose and stops answering your lean until you slow down.
- **Top speed is about 66 mph** (107 km/h). From about 58 mph the wheel **beeps**, faster as you go faster, and *Max
  speed* blinks with the beeps. Hold more than about 62 mph and it cuts out: you crash.

### Crashes

Riding into a building, a post, a car, a bus, a person or the edge of the waterfront fast enough is a crash, and so are a
cut-out and a landing that is too hard. After a moment a prompt shows how to get up: **R** on a keyboard, **B** on a gamepad, **GET UP** on
a touch screen. You get up where you fell (at the last safe spot if you fell into water). If you just wait, or start leaning again, the wheel puts you back on at
the last safe spot you rode through.

Slower knocks only stop you or scrub your speed.

## The city

- **Traffic is solid.** Cars and buses brake for a rider ahead of them, and stop and wait when they touch you. A car
  hitting you at speed knocks you down.
- **People are solid too.** They step aside if they see you coming. Bump one and they stumble out of the way and let
  you know what they think of it.
- **Central Park** sits behind its low stone wall, a metre above the street. Ride in by its gates, which are the real
  entrances: on Central Park South at 6th Ave, 7th Ave, 8th Ave and near 5th Ave; on 5th Ave at 72nd, 90th and 102nd
  St; on Central Park West at 72nd, 85th and 100th St; and on 110th St. Inside, the ponds and the Reservoir are water,
  not ground: the wheel stops at the shore, and hit it fast and you go in. The Reservoir's running track is a raised
  loop you can hop onto.
- **Bryant Park** stands on a raised terrace. Ride up by the two ramps on its 6th Ave side, either side of the
  fountain; the lawn is a kerb higher again.
- **The squares** (Madison, Union, Washington and Tompkins Square Parks) have iron fences: ride in by their gates.
  Park walks, lawn beds and the Times Square and Herald Square plazas are a little above the road, like kerbs.
- **Buildings are solid exactly where they stand.** Plazas, the lawns round housing towers, gaps between buildings and
  the open ground under raised buildings (601 Lexington Avenue's stilts, the tram station) can be ridden.
- Bridges and the highway decks are not rideable yet.

## Controls

| | Keyboard | Gamepad (Xbox layout) |
|---|---|---|
| Lean forward / back | `W` / `S` (or arrow keys) | RT / LT, or left stick |
| Carve | `A` / `D` | Left stick |
| Hop | `Space` | A |
| Crouch (charge a hop) | `Shift` | X |
| Get up after a crash | `R` | B |
| Rider | `1` / `2` | LB / RB |
| Camera | `V` cycles (`Shift`+`V` back), `5`–`0` pick | Y cycles; right stick orbits |
| Orbit the camera | Drag with the mouse | Right stick |
| Map | `M` | Start |
| Sound on / off | `N` | |
| Clean view (hide the HUD) | `H` | |

The hints at the bottom of the screen follow whichever you used last.

### Touch screens

- **Ride:** put your left thumb down anywhere in the bottom-left of the screen and a stick appears under it. Push up
  to lean forward, pull down to brake or reverse, push sideways to carve. Lift your thumb to let go.
- **HOP** and **CHARGE** (crouch) sit under your right thumb. **GET UP** appears next to them after a crash.
- **Look around:** drag anywhere else on the screen; pinch to zoom.
- The rider and camera buttons, the map and the menus are all tappable. Portrait and landscape both work.

## Riders

**Cool Rider** and **Trollina**, both from *EUC Thrills*. Switch at any time with the buttons at the bottom; the ride
carries on, only the rider changes. Each has their own crash voice.

## Cameras

Three follow cameras (*3rd-Person Chase*, *Low-Angle Action*, *First-Person*); the first two move in front of a
wall rather than into it. And scenic views around the city: Central
Park, 5th Ave and the Empire State Building, Times Square, 42nd St, the Empire State observatory deck, Bryant Park, the
East River, and an aerial auto-director. Pick one from the camera menu (bottom right; top right on touch screens).

## Getting around

- **Map** (`M`, Start, the map button, or tap the minimap): the whole of Manhattan with street and landmark search.
  **Click or tap any spot on the map and you are there,** exactly where you pointed: a street corner, a lawn, a
  plaza, a courtyard. It is the quickest way to get anywhere. The map also carries the credits.
- **Teleport** menu (top right): eight landmarks, from Times Square to One World Trade Center.
- **Time of day** (top right): golden hour, midday, blue hour and night. At blue hour and night the wheel's headlight
  comes on with the cars' and lights the road ahead.

## What the game saves

In your browser only: the rider you chose and where you were (every few seconds and when you leave), and whether
sound is on. Nothing is sent anywhere.

## Credits

- Riding, riders and wheel sounds: [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder (code
  MIT, assets CC BY 4.0; see [NOTICE-EUC-THRILLS.md](NOTICE-EUC-THRILLS.md)).
- The city: [three.js New York](https://github.com/mrdoob/slop-newyork) by Mr.doob (MIT).
- Map data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
