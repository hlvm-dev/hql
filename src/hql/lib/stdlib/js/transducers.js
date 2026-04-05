// transducers.js - Re-exports from self-hosted.js
// Transducer functions are now self-hosted in stdlib.hql.
// This file exists for backwards compatibility.

export {
  mapT,
  filterT,
  takeT,
  dropT,
  takeWhileT,
  dropWhileT,
  distinctT,
  partitionAllT,
  composeTransducers,
  cat,
  dedupe,
  removeT,
  keepT,
  mapcatT,
} from "./self-hosted.js";
