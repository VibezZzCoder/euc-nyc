# NYC Spin-off: EUC Thrills — player guide

The long version of the [README](README.md): how the wheel rides, the city, every control, and what the game saves.
The riding comes from [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder; the city is a fork
of Mr.doob's three.js New York.

The game is about the freedom to explore Manhattan. Tricks and skateparks are optional ways to enjoy the ride;
there is no required trick progression or scoring objective.

**Full-roster update (2026-10-31):** the eleven-rider picker includes rider and wheel profiles, selected sounds,
NYC pause/return controls and a controller-operated map cursor. The controls below cover keyboard, gamepad and touch.
Launch NYC from the EUC Thrills main menu or open it directly.

**Collision + park update (2026-11-01):** the clearance corrections and park behavior below improve riding while
the surrounding city remains active.

## What you need

To launch NYC directly from a phone Home Screen, open NYC's own game URL in the browser and use the browser's
Add to Home Screen action. The city has its own icon and app scope; installation behavior varies by browser/device.

An up-to-date browser with hardware acceleration. WebGPU is preferred; the renderer automatically tries WebGL2 if
WebGPU is unavailable. Keyboard, gamepad and touch controls work. Sound starts after your first click, key or tap.

For a WebGL2 comparison, open **[NYC with `?webgpu=0`](https://vibezzzcoder.github.io/euc-nyc/?webgpu=0)**.
Relevant WebGPU validation failures, or startup out-of-memory/device loss, attempt one reload into WebGL2.
The pause menu shows **Build … · WebGPU/WebGL2**, including whether automatic fallback occurred. Include that text,
OS/browser version and the steps that failed in a device report. Desktop checks of this update are complete within
their recorded scopes; current physical iPhone/MacBook stability and sustained device performance remain unverified.

### Changing screen size

Rotating or resizing the browser keeps the same riding session and adjusts the view to the available space. If you
are holding the stick, dragging the camera or panning the map, lift and touch again after the change. On short screens,
map controls form a horizontal row below the search bar so Close stays reachable; narrow portrait screens use that row too. The booking receipt can be scrolled
to reach **Back to riding**. Foldable-sized layouts have automated coverage; physical foldable/Safari testing is pending.

### Frame rate, 3D resolution and graphics

The upper-left controls let you choose **Frame rate**, **3D resolution** and **Graphics** independently. On compact touch
screens, the first two labels shorten to **FPS** and **3D res**. The number beside the FPS label is the actual rendered
rate. All three choices are remembered for your next visit when browser storage is available.

- **Frame rate:** Auto follows your display; 120, 60 and 30 cap scene rendering when your device can reach that rate.
- **3D resolution:** **100%** keeps the existing sharpness. **75%** is a softer compromise;
  **50%** is softer again and draws substantially fewer pixels. These scale both width and height: roughly 56% and
  25% of the current pixel count, respectively. They do not mean a percentage of the phone's full Retina resolution.
- **Graphics:** **High** (green) keeps the original appearance. **Medium** (yellow) removes screen-space
  reflections and uses lower-resolution sun shadows, keeping bloom. **Low** (red) also removes bloom and cast sun
  shadows. Basic lighting, environment reflections and colour grading remain.

Initially, phones use **Medium / 75%** and desktop uses **High / 100%**. Saved settings override these defaults
independently. Rotating, unfolding or connecting a controller does not reset your choices. You can select High / 100%
on a phone. The default is a starting point, not a guarantee that a particular device will remain stable.

Lower Graphics or 3D resolution can help a graphics-limited device; improvements depend on the device and scene.
Try Medium first, or Low with 50% resolution when speed matters most. An FPS cap can help with power use and pacing;
it does not make a slow device reach the selected rate. The menus, HUD, map and touch controls keep their normal size
and sharpness. Riding physics, input, traffic, city geometry and available routes remain the same. Switch quality
in-session without restarting the ride; the first use of an effect preset may briefly prepare its shaders.

## Starting

After loading, the title screen shows the city with your current rider in it. Open **Choose rider** to browse the
roster, rider profiles and original wheel descriptions. Your current rider is marked **Riding**; **Browsing** shows
whose details you are reading. Use the named **Select** button to change, or **Cancel** to keep your current rider.
Browsing neither constructs another rig nor plays crash samples. Wait for preparation to finish before choosing **Ride** (or Enter / gamepad A
on the Ride action). Audio/worker preparation failures offer **Retry** or **Cancel**. An appearance-module download
failure offers **Reload NYC** because its failed import may stay cached in the current page. Reload keeps your
committed rider/checkpoint and corrects any older URL rider override; the pending choice is never saved. You can
also cancel or choose a different rider. Leaving/reloading before Ride does not authorize a new position save.
The same confirmed picker is available from gameplay; its dialog holds riding input while you choose.

The loader names the current stage and counts completed shader batches. After shader compilation, it prepares shadows
and waits for the first graphics frame before showing the title.

If the game cannot start, the loading screen shows an explanation and a **Retry** button. A graphics failure includes
browser and hardware-acceleration tips; a failed download suggests checking your connection. **Technical details** can
be expanded to help troubleshoot. Retry reloads the page and keeps your saved settings. If a link opened inside another
app fails, try opening it directly in Safari or Chrome.

If the graphics device is interrupted during a ride, the same screen offers Retry rather than leaving the game
silently frozen. Your existing position save is protected during loading and the title screen; saving a new session
starts when you choose Ride.

The title screen links to the [EUC Thrills website](https://euc.erodmen.com/). While riding, **Website ↗** sits beside
**GitHub ↗** in the top-left header. Both open in a new tab, keeping the game open.

### Pause and return to EUC Thrills

Open **Menu** with `Escape` / `P`, gamepad **Back / View (button 8)**, or the on-screen menu button. Choose
**Resume riding** to continue. Start still opens the map. In the picker or map, Escape/B dismisses that
dialog first; booking has its own controls and cannot be skipped with those shortcuts.

The menu, Rider picker and full map freeze riding, traffic and pursuit clocks and silence playback. Returning to
the city does not catch up the paused time. Keyboard focus returns to the control that opened a dialog; click/tap
the city canvas to resume riding keys after using a button. Held keys/buttons must be released before fresh actions.

The separated **Return to EUC Thrills main menu** action leaves NYC in the same tab. The loading, error and title screens
also offer **← EUC Thrills main menu**. These replace NYC in that tab's history. The title link is distinct from the
website links above. Leaving before Ride does not authorize a new NYC save.

The main game opens its top-level menu at **https://vibezzzcoder.github.io/EUC-thrills/**, without a special menu query,
and its title menu offers NYC. The owner reports successful live round trips on phone and computer. This establishes
basic manual navigation; detailed input and back/forward-cache (BFCache) behavior remain unspecified.
NYC and the main game keep separate saves; no cross-game progress or rider transfer is promised.

## Riding

The wheels have rubber tread, moulded sidewalls and detailed metal hubs. These turn with the wheel's actual
travel, including in reverse; the shell and pedals stay with the rider.

You ride an electric unicycle through Manhattan, from the Battery to Harlem. A few things are specific to a real
wheel and worth knowing before they surprise you:

- **You lean to go.** Leaning forward accelerates, leaning back brakes, and holding back from a standstill rolls you
  backwards. Carving is leaning into the turn: the faster you go, the wider the line.
- **Kerbs must be hopped.** Manhattan's kerbs are 22 cm, just above the unchanged 21.6 cm step-up limit. Roll
  into one slowly and you stop at its face; hit one at speed (about 8 mph / 13 km/h or more) and you go over the
  front. Hop just before it.
- **Crouch charges the hop.** Hold crouch for a moment, then hop, for a jump about 40% higher.
- **The wheel tells you when it is working hard.** Riding fast, accelerating hard, climbing and heavy landings all
  load it. A warning shows above the speed: *Working hard*, then *Ease off*. Push further and the wheel **tilts
  back**: it lifts its nose and stops answering your lean until you slow down.
- **Top speed is about 66 mph** (107 km/h). From about 58 mph the wheel **beeps**, faster as you go faster, and *Max
  speed* blinks with the beeps. Hold more than about 62 mph and it cuts out: you crash.

The game adjusts the grounded tyre pose around climbable stair edges and the posed torso beside walls
to reduce visible clipping. These corrections affect the drawing only; wheel motion, contact and street handling
still come from the riding simulation.

### Simple tricks

The same **Hop** button handles ordinary jumps, one-foot airs and 180s:

| Trick | Keyboard | Gamepad | Touch |
|---|---|---|---|
| Normal hop | Tap **Space** | Tap **A** | Tap **HOP** |
| One-foot air | Hold **Space** through takeoff | Hold **A** | Hold **HOP** |
| 180 | Hop, release, then press **Space** again while rising | Release and press **A** again while rising | Release and tap **HOP** again while rising |
| One-foot 180 | Keep that second **Space** press held | Keep that second **A** press held | Keep that second **HOP** press held |
| Air tuck | Hold **Shift** in the air | Hold **X** in the air | Hold **CHARGE** in the air |
| Fakie ride-out | Land a 180 and keep rolling backward | Same | Same |

The jump starts on the first press; it never waits for a double-tap decision. A held airborne pose needs a brief
hold and enough airtime to enter and return for landing. Charge a bigger hop first to give yourself more room.
Keeping crouch/charge held after takeoff adds the tuck; holding Hop too combines tuck and one-foot. Release a
control to return from its pose. Very late holds or short drops may not have enough air to show a trick.

A successful landing briefly shows **Landed · One-foot air**, **One-foot 180**, **Air tuck**, or their combination.
After a landed 180, rolling backward continuously for at least **0.8 seconds and 1.5 metres**, above about
**1.7 mph / 2.7 km/h**, adds **→ Fakie**. Stopping, leaving the ground again or crashing breaks that ride-out.
Ordinary reversing from a standstill does not count. These are trick labels, not a points/leaderboard mode.

Try the clear central line at **Thomas Jefferson Skatepark** or the flat run-ups at **Pier 62**. **Action** and
**Side Tracking** are useful for watching the foot lift and tuck. The full roster uses the same trick controls;
animation polish and costume/mark fidelity still benefit from owner playtest.

### Riding the skateparks

The riding behavior follows the existing banks, quarter-pipes and rollers at **Thomas Jefferson** and
**Pier 62**, using their existing shapes and layouts:

- **Steep stalls:** an uphill stall on a sufficiently steep riding face can turn you downhill to roll back out.
- **Come-back airs:** a qualifying steep climb can send you back toward the face, with an automatic turn when needed.
  Speed, approach angle and the shape of the lip matter; not every ramp produces this air.
- **Kicker lips:** the launch can carry the approach slope across a short flat lip. The usual Hop and charged-hop
  controls still apply.
- **Local recovery at rest:** you restart stationary when the validated floor beneath your fallen body or the checked
  recovery destination is an eligible park surface. Recovery still checks support, water, standing room, moving
  occupants and a way out; blocked ground can require a checked fallback or another attempt.

The behavior follows the actual riding surface and its height, rather than the whole area around a park. Flat
platforms, steps and benches are not transition faces, and a street or deck at another height keeps its normal
handling. A qualifying air keeps its in-flight behavior through landing even after leaving the feature.
Automatic downhill/come-back turns do **not** count as a player 180 or qualify a Fakie by themselves; use the normal
hop/release/repress spin for that feedback. This remains optional free riding with the existing trick labels.

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
  **Gapstow and Bow bridges** have connected walking decks and matching gentle approach ramps: ride across from
  either bank. Their stone parapets are solid; the pond beneath remains water.
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
  ride back toward shore to reach the upper lawn through its open landing. The map selects clear city ground and
  registered bridge, pier or rooftop riding surfaces; ordinary building collision caps are not rooftop destinations.
  The surrounding boroughs and distant outer bridges remain scenery rather than a fully rideable second city.

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
| Rider picker | `C`; legacy `1` / `2` open/highlight Cool Rider / Trollina | LB / RB open/highlight picker |
| Camera | `V` cycles (`Shift`+`V` back), `5`–`0` pick | Y cycles; right stick orbits |
| Orbit the camera | Drag with the mouse | Right stick |
| Map | `M` | Start |
| Pause / menu | `Escape` or `P` | Back / View (button 8) |
| Sound on / off | `N` | |
| Clean view (hide the HUD) | `H` | |

The hints at the bottom of the screen follow whichever you used last. `1` / `2` and LB/RB do **not** immediately
switch riders: confirm in the picker. Camera keys `5`–`0`
are unchanged. Release held riding controls at menu boundaries and use fresh confirmations so selecting never hops.

### Touch screens

- **Ride:** put your left thumb down anywhere in the bottom-left of the screen and a stick appears under it. Push up
  to lean forward, pull down to brake or reverse, push sideways to carve. Lift your thumb to let go.
- **HOP** and **CHARGE** (crouch) sit under your right thumb. **GET UP** appears next to them after a crash.
- **Look around:** drag anywhere else on the screen; pinch to zoom.
- The rider and camera buttons, the map and the menus are all tappable. Portrait and landscape both work.

## Riders

The reviewed roster from *EUC Thrills* v1.1.0, in source order:

| Rider | URL / saved rider ID |
|---|---|
| Cool Rider (default) | `cool-rider` |
| Trollina | `trollina` |
| Red Rider | `red-rider` |
| Adonisb2 | `adonisb2` |
| Maribel Vargas | `maribel-vargas` |
| Wheel in Motion | `wheel-in-motion` |
| The Drunkard | `drunkard` |
| FloWithZo | `flo-with-zo` |
| Seal on a Wheel | `seal-on-a-wheel` |
| Wyldist | `wyldist` |
| Gnarwheel | `gnarwheel` |

Use **Choose rider** on the title screen, **Change rider** / `C` during gameplay, or the picker shortcuts above.
Browse with **LS / D-pad**; **RS** scrolls rider/wheel details on smaller screens; **A** selects or activates the
focused action, **B** returns. The named Select button makes the change explicit. Preparation keeps the committed
rider until the replacement is ready. **Retry** retries an audio/worker preparation failure; appearance-module failure
uses **Reload NYC** as described above. **Cancel** keeps the committed choice.
Each rider maps to their reviewed wheel/look/crash sound; not every crash sound contains that rider's voice.
The Drunkard is a fictional parody with native weave/sway/stumble style and a separate stumble sound, not a real
participant or a new character-stat system. Officer Dorkins (`cop`) remains NPC-only.

Eight riders represent real people. Their identities, supplied logos and contributed recordings have separate rights;
the owner considers their EUC Thrills permissions applicable to NYC, without claiming independently verified expanded
grants. City signage stays fictional/generic, with a narrow owner exception for reviewed rider marks including SMLS
on Wyldist's left sleeve. That decision conveys no additional third-party permission. See
[the notice](NOTICE-EUC-THRILLS.md) and [fork guide](FORK_GUIDE.md) for credits and reuse boundaries.

## Cameras

All eleven views follow **your current location and elevation**. Pick from the camera menu (bottom right; top right
on touch screens), or cycle with **V / Shift+V**, the camera arrows or gamepad **Y**.

| View | Framing |
|---|---|
| **3rd-Person Chase** (`5`) | Behind the rider, with a view of the road ahead. |
| **Low-Angle Action** (`6`) | Close, low rear-quarter view. |
| **First-Person** (`7`) | Rider's-eye view. |
| **Elevated** | Raised trailing view of the rider and nearby surroundings. |
| **Avenue** (`8`) | Longer rear view along the street ahead. |
| **Crossroads** (`9`) | Wider three-quarter tracking shot. |
| **Architecture** (`0`) | Low architectural angle with the rider in the foreground. |
| **Overlook** | High, downward view centred near the rider. |
| **Side Tracking** | Close lateral view of the rider and wheel. |
| **Panorama** | Wider side/rear view; favours a clear nearby water-side angle when available. |
| **Auto-Director Aerial** | Slow aerial orbit that travels with you. |

The former landmark views now film your ride wherever you are; their saved selections and shortcuts still work.
The cinematic views ease around turns, can choose a clearer side, and retract when buildings or overhead structures
block the camera. Drag/right-stick to look and pinch/wheel to zoom in Chase and the cinematic views; First-Person
supports looking, while Action keeps its fixed rear-quarter angle. Looking manually pauses the Director's automatic
orbit briefly. Portrait framing reduces the cinematic look-ahead so the rider stays in view.

Your chosen view returns when you press **Ride** on your next visit and stays selected when changing rider. The title
screen still circles the rider; teleporting and booking release temporarily select Chase without replacing your saved choice.

## Getting around

- **Map** (`M`, Start, the map button, or tap the minimap): the whole of Manhattan with street and landmark search.
  Click/tap a spot to request a safe arrival at or near that point: a street corner, lawn, plaza or courtyard.
  Placement checks your full standing space, support, water and moving occupants. If no safe arrival is available,
  you stay where you were; map feedback explains that you can choose another spot or try again. The map also carries the credits.
  A click on a registered bridge deck or pier terrace selects its highest surface; reloading restores the saved
  elevation, including a lower walkway beneath an upper one.
  Riding controls and background shortcuts are disabled while the map is open; traffic and chase clocks freeze. Search
  results include native landmark buttons: press Down or Tab from search, then Enter/Space on the desired result.
  Escape closes the map and returns focus. Multi-finger map gestures do not teleport; use + / − to zoom.
  The yellow **waypoint line** shows direction only; it is not a road-following or obstacle-aware route.
  **Controller map controls:** **LS** moves the visible cursor (pushing outward at an edge also pans); **RS** pans;
  **LT / RT** zoom out/in; **A** activates a map button under the cursor or requests a safe teleport on the map.
  **X** centers on you, **Y** fits all Manhattan, **D-pad** selects controls/existing search results, **B / Start**
  closes and **View** opens the menu. Select a control/result, release, then press a fresh A. Search text entry uses
  the keyboard; map movement works even if the search field has focus. After opening/resizing, changing controllers
  or returning to the tab, center both sticks and release buttons/partial triggers before moving again.
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

The touch action buttons also support Enter/Space while focused. Assistive click activation taps HOP/GET UP;
clicking CHARGE toggles its held state, announced as pressed. Activate it again to release, or use HOP (its release
clears the click-toggle). Physical finger holds continue to work normally.

## Frame rate

Use **Frame rate** below the upper-left header to choose **Auto**, **120**, **60** or **30** frames per second. On narrow
touch screens the label shortens to **FPS**. Auto is uncapped and follows your display and browser; the other choices limit
how often the city is drawn, which can reduce graphics work.
They are limits, not guaranteed performance: 120 FPS needs a sufficiently fast display and device; on a 60 Hz display it
cannot draw more than 60 frames per second. Riding physics, traffic speed and visual detail stay the same.

Click/tap the selector, or reach it with Tab and use the arrow keys. Your choice is saved for the next visit; if browser
storage is unavailable, it lasts for the current visit. The FPS readout reports the actual rendered rate.

## What the game saves

In your browser only: the successfully committed rider and where you were (every few seconds and when you leave), whether
sound is on, and your manually selected camera and time of day (saved when changed). View preferences are separate
from the rider's position save. If browser storage is unavailable, the game still works with preferences kept for
the current visit. Position saving starts only after Ride; browsing, failed/cancelled preparation and pending rider
choices never overwrite the checkpoint. Reload NYC keeps the committed identity, not the failed candidate.
Nothing is sent anywhere.

## Credits

- Riding, riders and wheel sounds: [*EUC Thrills*](https://github.com/VibezZzCoder/EUC-thrills) by VibezZzCoder (code
  MIT, original assets CC BY 4.0 with identity/logo/contributed-recording/generated-vocal exceptions; see
  [NOTICE-EUC-THRILLS.md](NOTICE-EUC-THRILLS.md) and [audio provenance](audio/euc/PROVENANCE.md)).
- The city: [three.js New York](https://github.com/mrdoob/slop-newyork) by Mr.doob (MIT).
- Map data: NYC Open Data and © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
