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

The title screen links to the [EUC Thrills website](https://euc.erodmen.com/). While riding, **Website ↗** sits beside
**GitHub ↗** in the top-left header. Both open in a new tab, keeping the game open.

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
  Park walks, lawn beds and the Times Square and Herald Square plazas are a little above the road, like kerbs. The
  low fences round lawn beds are solid too. Fountain rims and monument bases are obstacles; fountain water is not
  a place to get back on the wheel. Washington Square Arch's centre passage stays open.
- **Duffy Square's red steps** are ridden at each tread's height, rising above the plaza. Take them slowly: closely
  spaced risers can stop a fast approach. Central Park's rock outcrops follow their visible slopes, and Castle Clinton
  has solid walls with an open entrance.
- **Street furniture is solid:** hydrants, mailboxes, food-cart bodies, benches, planters, lamp posts and tree trunks.
  Low objects stop at their visible heights, rather than having tall invisible walls over them.
- **Buildings are solid exactly where they stand.** Plazas, the lawns round housing towers, gaps between buildings and
  the open ground under raised buildings (601 Lexington Avenue's stilts, the tram station) can be ridden.
- **The waterfront** can be ridden out to the river: along the Hudson and the East River you go all the way to the
  esplanade's iron railing, round the Battery to its railing, and where there is no railing to the edge of the quay.
  Ride through open pier entrances onto their promenades. Pier decks, raised lawns, benches, posts, railings and
  terminal buildings have physical surfaces and bodies. Little Island's park follows its hills and gangways. The
  riverside grass belts, their raised curbs and their stone walls are physical too; hop the higher edges.
  Open pier mouths have matching gaps in the shoreline fence. Moored vessels have solid hulls, cabins and major deck
  equipment. Little Island's gangway handrails and the rails on Duffy Square's steps are solid too.
  Both Little Island gangways join the park's curved lawn edge, with clear openings through its rim.
  Beside Pier 57, the waterfront road has a clear turning area; Little Island's north gangway starts on its
  river-side verge, so the raised deck no longer crosses the car lanes.
- **The north end:** the city stops just past 129th St, at a line of blue police barricades ("Police line · do not
  cross") across the island. Cars drive on past them and out of sight.
- **Elevated routes:** the Queensboro, Williamsburg, Manhattan and Brooklyn bridge decks, the elevated FDR and upper
  pier terraces now support riding at their own heights. You can still ride underneath where the ground route is
  open. Brooklyn's approach has a clear paved route through the park; the FDR's entrance follows a continuous road.
  A raised bridge anchorage lip may still need a hop. At **Pier 15**, enter the ramp near the outer end of the pier and
  ride back toward shore to reach the upper lawn through its open landing. Other high rooftops can be reached with
  the map. The surrounding boroughs and distant outer bridges remain scenery rather than a fully rideable second city.

## Officer Dorkins

Now and then, **Officer Dorkins** ambushes you on his police hover-wheel: a glowing ring where the tyre should be,
thrusters under his feet, a red and blue light bar. A siren blast and a banner announce him; he turns up somewhere
you can't see, usually behind you, flies over the traffic and the low roofs, and drops in low right behind you. His
siren gets louder the closer he is, his blip flashes on the radar, and at night his searchlight finds you.

- **Losing him:** get out of his sight (round corners, behind buildings) and stay out of it for 6 seconds, or get more
  than 150 m away from him for 2 seconds. While he can't see you, the cue by the speedometer says so and fills up as
  you get away. Your wheel is faster than his on a straight (about 100 km/h against his 61), but he cuts over the
  low rooftops.
- Crashing doesn't help: his clocks stop while you are down.
- Once you lose him, he climbs away into the sky. He comes back, but not for a while.
- **His paddle:** when he catches up with you (and you are not getting away at speed), he swoops in low on your left,
  crouches and swings his paddle at your wheel. You get a moment's warning: "Paddle! Hop or swerve", his light bar
  racing and a rising whoosh. Hop as it comes (a charged hop, Shift then Space, is easier to time) or swerve away
  from him. If it connects you go down: busted. He hovers over you a moment, then flies off; he comes back, but not
  for a while. If he misses, he tries again a couple of seconds later.
- `?cop=0` at the end of the address leaves him out.

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
Your chosen camera returns when you press **Ride** on your next visit. The title screen still circles the rider;
teleporting or changing rider from a scenic view temporarily selects Chase without replacing your saved choice.

## Getting around

- **Map** (`M`, Start, the map button, or tap the minimap): the whole of Manhattan with street and landmark search.
  **Click or tap any spot on the map and you are there,** exactly where you pointed: a street corner, a lawn, a
   plaza, a courtyard. It is the quickest way to get anywhere. The map also carries the credits.
  A click on a registered bridge deck or pier terrace selects its highest surface; reloading restores the saved
  elevation, including a lower walkway beneath an upper one.
- **Teleport** menu (top right): sixteen stops. Alongside the eight landmarks are the Manhattan approaches to all
  four East River bridges, the FDR climb, Pier 15's lower ramp entrance, Little Island's gangway and the Hudson River
  Greenway at Pier 84. Pier 15 deliberately arrives downstairs; ride shoreward up the ramp to reach the lawn.
- **Time of day** (top right): golden hour, midday, blue hour and night. At blue hour and night the wheel's headlight
  comes on with the cars' and lights the road ahead. Your selected time of day is remembered for the next visit.

## What the game saves

In your browser only: the rider you chose and where you were (every few seconds and when you leave), whether
sound is on, and your manually selected camera and time of day (saved when changed). View preferences are separate
from the rider's position save. If browser storage is unavailable, the game still works with preferences kept for
the current visit. Nothing is sent anywhere.

## Credits

- Riding, riders and wheel sounds: [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder (code
  MIT, assets CC BY 4.0; see [NOTICE-EUC-THRILLS.md](NOTICE-EUC-THRILLS.md)).
- The city: [three.js New York](https://github.com/mrdoob/slop-newyork) by Mr.doob (MIT).
- Map data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
