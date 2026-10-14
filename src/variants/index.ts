import * as THREE from "three";
import { driftBody } from "./drift-body";
import { tide } from "./tide";
import { halo } from "./halo";
import { charcoal, graphite } from "./graphite";
import { ripple } from "./ripple";
import { liquid } from "./liquid";
import { swarm } from "./swarm";
import { membrane } from "./membrane";
import type { Variant } from "./types";

// Hex params go straight into raw ShaderMaterials; keep colours as authored (sRGB in, sRGB out).
THREE.ColorManagement.enabled = false;

// Order = number keys. To fork an idea: copy a file, give it a new id, add it here.
export const VARIANTS: Variant[] = [
  // new — iter/06: forms built on the presence layer + temperature colour
  charcoal, graphite, halo, ripple, liquid, swarm,
  // calm pass
  driftBody, tide, membrane,
];
