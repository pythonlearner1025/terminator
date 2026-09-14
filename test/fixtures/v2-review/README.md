# Immutable V2 review references

`collision-89c1d8e.js` is the byte-exact project collision implementation from the supplied performance baseline. `baseline.json` records its full source commit and SHA-256, plus the original `cd47f65` authored-scene semantic hashes and exact player-camera / target-image / view-config file hashes.

The review test reads these files directly, so a fresh clone of a squashed integration branch does not need either historical Git object. Scene hashes use recursively sorted object keys and JSON serialization; array order and every value remain significant. The original authored node prefix is checked while later preview nodes remain permitted, matching the original contract. Missing scene properties remain distinct from present values.

Do not regenerate these references to make a candidate pass. Changes to the protected visual baseline require an explicit new contract and review. Collision optimization is compared with this original implementation on all authored colliders, including seeded footprint, overlap, ray and swept-sphere queries.
