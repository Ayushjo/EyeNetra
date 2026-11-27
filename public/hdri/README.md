# HDRI environment maps

`phone_shop_1k.hdr` — "Phone Shop" by Philip Modin, Poly Haven
(https://polyhaven.com/a/phone_shop), CC0 (public domain). 1k Radiance HDR,
1,686,918 bytes, md5 d51639e99ad3f54c4b740d6022252da3.

Used by `src/components/TryOnCanvas.tsx` as the glasses' reflection/lighting
environment: a retail shop with lit display counters and rows of ceiling
lights, close to an optical showroom. Swap for another Poly Haven HDRI by
dropping its 1k `.hdr` here and changing `SHOP_HDRI` (e.g. `decor_shop` for
warm chandeliers, `leadenhall_market` for a covered market).
