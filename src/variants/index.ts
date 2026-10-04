import * as THREE from "three";
import { grainDuet } from "./grain-duet";
import { driftGrain } from "./drift-grain";
import { driftBody } from "./drift-body";
import { bloom } from "./bloom";
import { tide } from "./tide";
import { meter } from "./meter";
import { membrane } from "./membrane";
import { oneBody } from "./one-body";
import { twoBodies } from "./two-bodies";
import type { Variant } from "./types";

// Hex params go straight into raw ShaderMaterials; keep colours as authored (sRGB in, sRGB out).
THREE.ColorManagement.enabled = false;

// Order = number keys. To fork an idea: copy a file, give it a new id, add it here.
export const VARIANTS: Variant[] = [
  // calm pass — Claude, after round 2 (Grain Duet / one body + Warm Drift's temperature colour)
  driftGrain, driftBody, bloom, tide,
  grainDuet, twoBodies, oneBody, meter, membrane,
];
