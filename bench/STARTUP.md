# Startup optimization record

Measured September 11, 2026 on Apple M1 Pro, Chromium 149.0.7827.55. Initial source revision: fce6fa9, with the same startup milestone instrumentation added for measurement. All results use six fresh-browser samples per profile across the same three seeds.

## Measurements

Times are median milliseconds from navigation. Desktop: 1440×900, 20 Mbps/40 ms latency. Mobile: 390×844 touch viewport, 5 Mbps/80 ms latency on the same computer; no phone CPU emulation. Fixed Brotli quality 6 and a shared bandwidth budget cover page and worker downloads. Payload is compressed response-body bytes requested before terrain readiness.

| Experiment | Desktop backdrop | Desktop terrain | Mobile backdrop | Mobile terrain | Payload KiB |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starting code | 779 | 1368 | 2740 | 3577 | 1181 |
| Prepared content only | 673 | 967 | 2517 | 2892 | 1138 |
| Parallel worker and deferred UI | 648 | 756 | 2159 | 2269 | 1004 |
| Backdrop before WebGL | 603 | 704 | 2117 | 2241 | 1004 |
| Prioritize backdrop downloads | 587 | 808 | 2009 | 2350 | 1004 |
| Extra runtime preload (rejected) | 602 | 794 | 2044 | 2372 | 1005 |
| Retained implementation | 600 | 788 | 1930 | 2255 | 1005 |

The target was 25% faster backdrop and terrain startup in both profiles. The retained implementation improves desktop backdrop by 22.9%, desktop terrain by 42.4%, mobile backdrop by 29.6%, and mobile terrain by 36.9%. Three of four metrics meet that target; desktop backdrop is a narrow miss. Startup main-thread blocking falls from 297/327 ms to 33/33 ms (desktop/mobile), and measured transfer falls 15%.

Independent samples vary; small differences between adjacent experiments should not be treated as precise causal estimates. An extra runtime module preload did not provide a clear benefit and is omitted. The retained ordering prioritizes the first world-correct view, then overlaps authority startup with renderer preparation.

## Correctness and retained changes

- Production content is prepared during the Vite build. The emitted 17,992,628-byte wire packet is byte-identical to the source compiler. Deployment's quality-11 Brotli output is 85,379 bytes; this is separate from the fixed quality-6 laboratory measurements.
- The first backdrop uses the actual engine seed, starting camera, and sampled biome blend. There is no generic mobile backdrop. Shader/texture initialization yields a paint opportunity to that canvas.
- Worker initialization overlaps presentation construction. Survival controls/font and replay UI load only when needed, and mobile starts loading immediately while preserving its explicit START interaction.
- Readiness follows successfully applied and rendered terrain plus control setup.
- Initial authority-packet hashes and exact camera/biome metadata match across all sampled seeds and profiles. Input verification confirms press/release edges reach the authority.
- Engine benchmark checksum remains 0xa30dc201. Panning/flicker comparison passes with horizontal and vertical instability 0.

The backdrop and terrain metrics are completed draw submissions, not measured compositor/GPU timestamps. Main-thread long-task blocking excludes worker CPU. These figures describe the controlled local benchmark rather than production telemetry.

## Reproduce and maintain

Run `npm run build`, then `npm run bench:startup:compare` on the recorded environment. `bench/startup-baseline.json` retains the full selected samples and current reference. To establish a reference elsewhere, run `npm run bench:startup -- --json FILE`; compare it after a change with `node scripts/bench-startup.mjs --compare FILE`. Use `--target 25` to require a 25% gain in every primary metric, or the default 10% regression allowance for routine comparisons. See `scripts/README.md` for all settings.

Focused validation covers content, deployment caching, editor, lifecycle, production startup recovery, compiled startup/retry/standalone embed, worker recovery, and mobile controls. `compiled-startup` requires both `npm run build` and `npm run build:embed`.
