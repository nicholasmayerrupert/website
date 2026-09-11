`adventure-v3.checkpoint.gz` is a gzip-compressed, unmodified version 3 engine
checkpoint produced by revision `181cc1c`. It uses the authored Frontier seed,
a 160 × 128 loaded window, the Frontier mission, and the starting inventory with
seven extra Health cordials (eight total). It exercises migration to the current
checkpoint format without regenerating the old save using the current writer.

`status-v7.bin.gz` is a gzip-compressed version 7 checkpoint produced by revision
`52fad42` and round-tripped through that revision's reader. It uses a 160 × 128
Frontier window with seed 7, an active Frontier mission, and a shield anchor hit
by Ember while creature simulation is disabled. Its remaining 120-tick burning
timer exercises migration into the shared status system; player effects start
empty. The current writer must not be used to regenerate this legacy fixture.
