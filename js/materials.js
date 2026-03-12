// Material database: linear attenuation coefficients μ (cm⁻¹) at 662 keV
// Sources: NIST XCOM database

export const MATERIALS = {
  "G4_AIR": {
    mu_662: 0.0000897,
    density: 0.001205,
    color: [1.0, 1.0, 0.3],
    opacity: 0.05,
    label: "Air",
  },
  "G4_W": {
    mu_662: 1.128,
    density: 19.3,
    color: [0.55, 0.55, 0.55],
    opacity: 1.0,
    label: "Tungsten",
  },
  "CdZnTe": {
    mu_662: 0.443,
    density: 5.78,
    color: [0.2, 0.6, 1.0],
    opacity: 0.7,
    label: "CdZnTe",
  },
  "G4_Galactic": {
    mu_662: 0.0,
    density: 0.0,
    color: [0.0, 0.0, 0.0],
    opacity: 0.0,
    label: "Vacuum",
  },
  "G4_WATER": {
    mu_662: 0.0857,
    density: 1.0,
    color: [0.3, 0.5, 0.9],
    opacity: 0.25,
    label: "Water",
  },
  "G4_BONE_COMPACT_ICRU": {
    mu_662: 0.121,
    density: 1.85,
    color: [0.95, 0.9, 0.75],
    opacity: 0.6,
    label: "Bone",
  },
  "G4_LUNG_ICRP": {
    mu_662: 0.0226,
    density: 0.26,
    color: [0.9, 0.4, 0.4],
    opacity: 0.2,
    label: "Lung",
  },
  "G4_TISSUE_SOFT_ICRU": {
    mu_662: 0.0912,
    density: 1.06,
    color: [0.9, 0.6, 0.5],
    opacity: 0.35,
    label: "Soft Tissue",
  },
  "G4_Al": {
    mu_662: 0.201,
    density: 2.70,
    color: [0.75, 0.75, 0.80],
    opacity: 0.6,
    label: "Aluminum",
  },
  "G4_Ti": {
    mu_662: 0.254,
    density: 4.54,
    color: [0.6, 0.65, 0.7],
    opacity: 0.7,
    label: "Titanium",
  },
  "G4_Pb": {
    mu_662: 1.328,
    density: 11.35,
    color: [0.25, 0.25, 0.30],
    opacity: 0.9,
    label: "Lead",
  },
  "G4_PLEXIGLASS": {
    mu_662: 0.102,
    density: 1.19,
    color: [0.85, 0.85, 0.9],
    opacity: 0.2,
    label: "PMMA/Lucite",
  },
  "G4_MUSCLE_SKELETAL_ICRP": {
    mu_662: 0.0905,
    density: 1.056,
    color: [0.7, 0.3, 0.3],
    opacity: 0.35,
    label: "Muscle",
  },
  "G4_Si": {
    mu_662: 0.172,
    density: 2.33,
    color: [0.4, 0.4, 0.5],
    opacity: 0.6,
    label: "Silicon",
  },
};

const DEFAULT_MATERIAL = {
  mu_662: 0.1,
  density: 2.0,
  color: [0.8, 0.3, 0.3],
  opacity: 0.5,
  label: "Unknown",
};

export function getMaterial(name) {
  return MATERIALS[name] || DEFAULT_MATERIAL;
}
