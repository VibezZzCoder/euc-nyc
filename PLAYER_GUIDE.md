# NYC Spin-off: EUC Thrills — player guide

The long version of the [README](README.md): how the wheel rides, the city, every control, and what the game saves.
The riding comes from [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder; the city is a fork
of Mr.doob's three.js New York.

## What you need

An up-to-date browser with hardware acceleration. WebGPU is preferred; the renderer automatically tries WebGL2 if
WebGPU is unavailable. Keyboard, gamepad and touch controls work. Sound starts after your first click, key or tap.

### Changing screen size

Rotating or resizing the browser keeps the same riding session and adjusts the view to the available space. If you
are holding the stick, dragging the camera or panning the map, lift and touch again after the change. On short screens,
map controls form a horizontal row below the search bar so Close stays reachable. The booking receipt can be scrolled
to reach **Back to riding**. Foldable-sized layouts have automated coverage; physical foldable/Safari testing is pending.

## Starting

After loading, the title screen shows the city with your rider in it. Pick **Cool Rider** or **Trollina**, then
press **Ride** (or Enter, or A on a gamepad). You can still change rider at any time while riding.

The loader names the current stage and counts completed shader batches. After shader compilation, it prepares shadows
and waits for the first graphics frame before showing the title.

If the game cannot start, the loading screen shows an explanation and a **Retry** button. A graphics failure includes
browser and hardware-acceleration tips; a failed download suggests checking your connection. **Technical details** can
be expanded to help troubleshoot. Retry reloads the page and keeps your saved settings. If a link opened inside another
app fails, try opening it directly in Safari or Chrome.

The title screen links to the [EUC Thrills website](https://euc.erodmen.com/). While riding, **Website ↗** sits beside
**GitHub ↗** in the top-left header. Both open in a new tab, keeping the game open.

## Riding

Both riders' wheels have rubber tread, moulded sidewalls and detailed metal hubs. These turn with the wheel's actual
travel, including in reverse; the shell and pedals stay with the rider.

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
a touch screen. Get Up, leaning again and automatic recovery all look for clear, rideable ground near where your body
finishes falling. Water, unrideable hazards and unsafe or blocked landings send you back to a checked safe riding spot.
Recovery keeps the correct street/deck level and may turn you toward a clear way out. If every candidate is blocked,
it waits and checks again; an early Get Up tap is remembered until recovery is ready.

When the wheel hits a vehicle, the rider keeps their incoming momentum until their body meets it. A low hood or trunk
can catch the rider after they pitch forward; a tall cabin or bus can stop them. Moving cars can also impart a knock.
Cars and buses remain solid; the wheel still stops at them.

Slower knocks only stop you or scrub your speed.

## The city

City streets and highways mix taxis, sedans, SUVs, minivans, pickups and high-roof delivery vans. City buses have
several fictional liveries and route signs; ambient patrol vehicles include sedans and SUVs. Larger vehicles take up
more space. During a wipeout, a low hood or covered pickup bed behaves differently from a van's tall cargo body.

- **Civic Detention Jail** is an original fictional exterior on the historic north Tombs block, between Centre and
  Baxter Streets and Walker and White Streets. Find it through **Teleport → Civic Detention Jail**, or search **jail**
  on the full map. The White Street entrance has a clear forecourt, barred windows and warm intake lighting at night.
  Dorkins handles captured riders at a temporary intake desk outside this entrance; the chase and booking rules are below.
- **Traffic is solid.** Cars and buses brake for a rider ahead of them, and stop and wait when they touch you. A car
  hitting you at speed knocks you down.
- **People are solid too.** They step aside if they see you coming. Bump one and they stumble out of the way and let
  you know what they think of it.
- **Central Park** sits behind its low stone wall, a metre above the street. All 13 gates have ramped entrances and
  inner landings for riding in or out without hopping; ordinary kerbs elsewhere still need a hop. These are the real
  entrances: on Central Park South at 6th Ave, 7th Ave, 8th Ave and near 5th Ave; on 5th Ave at 72nd, 90th and 102nd
  St; on Central Park West at 72nd, 85th and 100th St; and on 110th St. Inside, the ponds and the Reservoir are water,
  not ground: the wheel stops at the shore, and hit it fast and you go in. The Reservoir's running track is a raised
  loop you can hop onto. Ramped openings also serve the park-road mouths near W65, W81, E79 and W106/Great Hill;
  the W106 ramps meet grass inside the park rather than a continuous paved path.
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
- **Storefronts keep their identity:** a shop's sign and matching light colour stay the same as nearby architectural
  details load while you ride around it. Display windows now show shallow simulated interiors with shelves and counters,
  generic fascia signs and framed shop doors; residential fronts have their own detailed entrances. These remain scenery.
- **Rooftop detail:** water-tower bands and ventilation grilles use filtered patterns to reduce shimmer at a distance.
  Thin park and waterfront railings also use filtered coverage while keeping their physical bodies and entrances.
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

- **Losing him takes a real escape:** stay out of his sight for **12 continuous seconds**, and keep more than
  **150 m** between you for **6 continuous seconds** while unseen. Both conditions must be met together. A glimpse
  resets the escape progress; briefly turning a corner or hiding nearby isn't enough. Your wheel is still faster
  on a clean straight (about 100 km/h against his 86), but he now closes on ordinary cruising and cuts over low rooftops.
- **Searching:** when he loses sight, he checks where he last saw you, then nearby streets. His searchlight follows
  that search rather than tracking you through walls. The cue says **Searching · get more distance** until you open
  a sustained gap; the green escape bar fills while you're genuinely losing him.
- Crashing doesn't help you escape. Pursuit and warnings stay active while you're down, and you get **3 seconds
  after getting up** before he can swing again. The full map and a hidden browser tab freeze his chase clocks.
- Once you lose him, he climbs away into the sky. He comes back, but not for a while.
- **His paddle:** when he catches up with you (and you are not getting away at speed), he swoops in low on your left,
  crouches and swings his paddle at your wheel. You get a moment's warning: "Paddle! Hop or swerve", his light bar
  racing and a rising whoosh. Hop as it comes (a charged hop, Shift then Space, is easier to time) or swerve away
  from him. His paddle must connect during the swipe, whether you're riding forward or in reverse.
  A successful knockdown adds **one warning** and he keeps pursuing. Misses and ordinary crashes don't add warnings.
  The three-segment heat strip fills over the first **three knockdowns**; the third is the final warning.
  Getting up and brief sight breaks never erase the tally. A fresh pursuit after a proper escape starts at zero.
- **Fourth knockdown: captured.** The next successful paddle hit takes you to **Civic Detention** for a short,
  slightly incompetent booking at the White Street intake desk. The first three hits always remain warnings.
- **Back to riding:** the booking reaches its release button in about nine seconds. Click/tap **Back to riding**,
  press a fresh **Enter / Space** on the focused button, or use a fresh gamepad **A** after returning the controls to
  neutral. You return upright on the jail-side pavement, facing along
  **White Street toward Centre Street**, with heat cleared and a quiet spell before Dorkins ambushes again.
  There is no fine or wheel penalty.
- **Skip:** click/tap **Skip booking** at any point. Capture initially focuses the heading, so keyboard users press
  **Tab** to select Skip, then a fresh **Enter / Space**. On a controller, release the buttons/triggers and centre both
  sticks, select Skip with the **D-pad / left stick**, then press a fresh **A**. Selecting and pressing A together only
  selects the button. **Esc, B and Start do not skip or confirm booking.** A busy exit is checked before releasing you;
  if asked to try again, the scene stays safely open. Release held keys/gamepad controls before riding again.
- Booking suspends riding/map/camera/rider input. It preserves your saved view preferences, then automatically frames
  release in Chase. Backgrounding pauses the booking; reloading during it resumes outside the jail.
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
**Central Park Oasis** looks from above the southern canopy toward the park and skyline.
Your chosen camera returns when you press **Ride** on your next visit. The title screen still circles the rider;
teleporting or changing rider from a scenic view temporarily selects Chase without replacing your saved choice.

## Getting around

- **Map** (`M`, Start, the map button, or tap the minimap): the whole of Manhattan with street and landmark search.
  **Click or tap any spot on the map and you are there,** exactly where you pointed: a street corner, a lawn, a
   plaza, a courtyard. It is the quickest way to get anywhere. The map also carries the credits.
  A click on a registered bridge deck or pier terrace selects its highest surface; reloading restores the saved
  elevation, including a lower walkway beneath an upper one.
- **Skate locations on the map:** search for Coleman, Tribeca / Pier 25, Pier 62, Andy Kessler / Riverside,
  Thomas Jefferson, Brooklyn Banks or Tompkins Square. They have named map pins and nearby location labels.
  **Pier 62 has a larger authored skatepark**, marked by a **skateboard icon** on both the map and minimap. Its connected
  slate-blue courts have banks, two quarter-pipes, rollers, a manual pad, ledges and a low rail, with open flat riding space
  between features. Gentle ramps connect both ends to existing paths. Search **Pier 62** and click/tap the skateboard to
  arrive facing the seaward riding line. Clicking ordinary ground away from the icon keeps normal map placement.
  The asphalt crossing beside it is an active traffic road.
  **Thomas Jefferson Skatepark** in East Harlem is a compact street-style interpretation of the real venue, also marked
  with a skateboard icon. Its slate court has a double bank, low quarter-pipe, banked platform, four steps with a smooth
  side bypass, two skate benches and rails. A wide central line and open ends give you room to turn or bypass obstacles.
  The northern bay adds a lower banked platform and two smooth rollers; a low manual pad sits beside the original rail.
  The elevated rails stop the wheel as drawn—use a well-timed charged hop for clearance, or ride around them.
  Search **Thomas Jefferson** and click/tap its icon for a clear arrival inside the court, just inland of the researched
  pin. Existing street/highway traffic and the surrounding trees remain outside the course.
  The other pins identify researched locations within the existing city scenery. Tompkins is a community skate spot and
  Brooklyn Banks a historic skate spot. Highbridge is beyond the playable north boundary.
- **Teleport** menu (top right): seventeen stops. Alongside the eight landmarks are the Manhattan approaches to all
  four East River bridges, the FDR climb, Pier 15's lower ramp entrance, Little Island's gangway and the Hudson River
  Greenway at Pier 84, plus Civic Detention Jail. Pier 15 deliberately arrives downstairs; ride shoreward up the ramp
  to reach the lawn.
- **Time of day** (top right): golden hour, midday, blue hour and night. At blue hour and night the wheel's headlight
  comes on with the cars' and lights the road ahead. Distant haze follows the sky colour at the horizon.
  Your selected time of day is remembered for the next visit.

## Frame rate

Use **Frame rate** below the upper-left header to choose **Auto**, **120**, **60** or **30** frames per second. On narrow
touch screens the label shortens to **FPS**. Auto is uncapped and follows your display and browser; the other choices limit
how often the city is drawn, which can reduce graphics work.
They are limits, not guaranteed performance: 120 FPS needs a sufficiently fast display and device; on a 60 Hz display it
cannot draw more than 60 frames per second. Riding physics, traffic speed and visual detail stay the same.

Click/tap the selector, or reach it with Tab and use the arrow keys. Your choice is saved for the next visit; if browser
storage is unavailable, it lasts for the current visit. The FPS readout reports the actual rendered rate.

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
