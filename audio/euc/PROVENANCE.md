# audio/euc — provenance

Sound files for the player's electric unicycle (`js/euc-audio.js`) and Officer Dorkins' siren (`js/nemesis-audio.js`). Each one is a byte-for-byte copy from the
public EUC Thrills repository. None of them was re-encoded or edited.

Assets from EUC Thrills by VibezZzCoder — CC BY 4.0 — https://github.com/VibezZzCoder/EUC-thrills

- Upstream: `VibezZzCoder/EUC-thrills` @ `5f45fff19b258e140833841ba2473069af751a12` (v1.1.0).
- Source folder: `assets/live/audio/`.
- Copied: 2026-10-23.
- Origin and copyright notice: `NOTICE-EUC-THRILLS.md` in this repository, from upstream `NOTICE.md`.

| File | Upstream path | sha256 | Author / origin | Licence |
|---|---|---|---|---|
| `crash_wipeout.wav` | `assets/live/audio/crash_wipeout.wav` | `44bec4433734386116c51190c54ee072569151fba2717058439f3259030dc4b0` | VibezZzCoder's own recording, including his own voice, used with his approval | CC BY 4.0 |
| `crash_trollina.wav` | `assets/live/audio/crash_trollina.wav` | `c88274f3ea5230cbbb7e19b726e45924f491c2fd10b74cc29401a7a10b51d662` | Composed by the EUC Thrills project. The slapstick layers (impact, spring, tumble clatter, slide, wheel settling) are synthesized from first principles. **The vocal beats are machine-generated** with a text-to-speech model (OpenAI `gpt-audio`), then cut, re-timed, pitch-shifted and mixed. | Synthesized layers: CC BY 4.0. **The machine-generated vocal layer is NOT covered by CC BY 4.0.** No copyright is claimed over it. It is redistributed on the same terms as the rest of the build. If you need a clean rights position, replace this file. |
| `overspeed_beep.wav` | `assets/live/audio/overspeed_beep.wav` | `363851aa808ed5a7c66a548bbbdd113ffdbe45fa4b8f9a310ed7085f925a87b6` | Synthesized by the EUC Thrills project: a 2565 Hz tone plus its second harmonic, rebuilt from measurements. It contains no recorded audio. | CC BY 4.0 |
| `wind_howl_loop.wav` | `assets/live/audio/wind_howl_loop.wav` | `042440716b1331ead0247d39bdd2e522318e226be049637305ed14d19675c3ba` | Derived from ["wind_howl2_stereo" by swiftoid](https://freesound.org/people/swiftoid/sounds/117611/) (Freesound #117611). The EUC Thrills project trimmed, filtered and loop-processed it. | CC0 / public domain. No attribution is needed; this entry is kept as provenance. |
| `siren_far_loop.wav` | `assets/live/audio/siren_far_loop.wav` | `09d77eacb93910f55565119a35b96b338c642f9862ba2723e2e077ac5e3100e7` | ["Police Siren" by TitanKaempfer](https://freesound.org/people/TitanKaempfer/sounds/746302/) (Freesound #746302), loop-processed by the EUC Thrills project (its chase siren, far). Copied 2026-10-24. | CC0 / public domain. No attribution is needed; this entry is kept as provenance. |
| `siren_close_loop.wav` | `assets/live/audio/siren_close_loop.wav` | `0f34dc0bf177406aaaaded4fb1ac7e980bf497dd4a29423218458606fd7feed6` | ["police siren.wav" by vlammenos](https://freesound.org/people/vlammenos/sounds/52906/) (Freesound #52906), loop-processed by the EUC Thrills project (its chase siren, close). Copied 2026-10-24. | CC0 / public domain. No attribution is needed; this entry is kept as provenance. |
| `tyre_solid_loop.wav` | `assets/live/audio/tyre_solid_loop.wav` | `5ca9cff89e24dbffc1ad0752d829de3a997420e14cd2756b4abf941b70ba45a9` | Synthesized from scratch by the EUC Thrills project: the "toko" tick, one per wheel revolution at 9 m/s | CC BY 4.0 |

## Rules

- Copy **only** the files listed above. Every other `crash_*` file upstream belongs to a character outside this fork's
  scope: this fork has only original fictional characters (Cool Rider, Trollina, Officer Dorkins). Never copy one,
  even if nothing plays it.
- `tests/euc-audio.test.mjs` checks that this folder holds exactly these seven `.wav` files, with these hashes.
- If a file is replaced, update its row (sha256, origin and licence) and the test together.
- Everything else the rider hears (motor, hop, landing, kerb impact, recovery chirp and rolling tyre noise) is
  synthesized at runtime by `js/euc-audio.js`. That code was written for this fork; no upstream audio code was copied.
- `wind_howl_loop.wav` is the game's only wind: the rider's speed wind (`js/euc-audio.js`) and, once it is decoded,
  the city's ambient wind (`js/audio-events.js` `createWindVoice().useHowl`).
