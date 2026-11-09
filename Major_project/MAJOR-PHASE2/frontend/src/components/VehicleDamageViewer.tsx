// VehicleDamageViewer.tsx
// Feature 9 (3D Vehicle Damage & Repair Intelligence) - interactive vehicle model.
//
// Honesty boundaries this component is built around, exactly as the specification
// demands (Step 11.5.D):
//   * This is a REPRESENTATIVE schematic assembled from primitive geometry. It is
//     not an engineering-accurate model of any specific make or model.
//   * A component is coloured only when a real finding maps to it. A finding whose
//     component has no mesh here is NOT pretended to be highlighted; the parent page
//     lists it separately as "not mapped to the 3D model".
//   * Anything the assessment did not record stays neutral grey - an absent finding
//     is shown as "not assessed", never as "undamaged".
//   * The "repaired" view is a labelled preview of the plan, not photographic proof
//     that work was completed.
import { useEffect, useMemo, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";

export type ViewerFinding = {
  component: string;
  label: string;
  severity: string;
  recommendation: string;
  detectionState: string;
  mappedTo3D: boolean;
};

type Props = {
  findings: ViewerFinding[];
  selectedComponent?: string | null;
  onSelectComponent?: (component: string) => void;
  /** "assessed" colours parts by their recorded condition; "repaired" is a preview. */
  viewState?: "assessed" | "repaired";
  height?: number;
};

// Neutral colour for a component with no recorded finding, and the severity ramp.
const BASE_COLOR = "#c4ccd6";
const SEVERITY_COLOR: Record<string, string> = {
  "no-visible-damage": "#2f855a",
  minor: "#e6c61b",
  moderate: "#dd6b20",
  severe: "#c53030",
  "requires-inspection": "#7c4dbc",
  inconclusive: "#6b7c93",
};

// Schematic placement of every mappable component on a primitive hatchback laid out
// nose-along -X. Positions are approximate; the point is a stable, readable mapping
// between a component key and a mesh, not geometric precision.
type Spec = {
  position: [number, number, number];
  size: [number, number, number];
  shape?: "box" | "wheel" | "glass";
  rotation?: [number, number, number];
};
const COMPONENT_SPECS: Record<string, Spec> = {
  "front-bumper": { position: [-2.02, 0.5, 0], size: [0.22, 0.4, 1.72] },
  "rear-bumper": { position: [2.02, 0.5, 0], size: [0.22, 0.4, 1.72] },
  bonnet: { position: [-1.3, 0.8, 0], size: [1.3, 0.08, 1.55] },
  roof: { position: [0.25, 1.34, 0], size: [1.5, 0.08, 1.5] },
  radiator: { position: [-1.86, 0.62, 0], size: [0.12, 0.42, 1.0] },
  windshield: {
    position: [-0.55, 1.14, 0],
    size: [0.08, 0.62, 1.42],
    shape: "glass",
    rotation: [0, 0, 0.5],
  },
  "rear-window": {
    position: [1.05, 1.14, 0],
    size: [0.08, 0.55, 1.42],
    shape: "glass",
    rotation: [0, 0, -0.5],
  },
  "door-front-left": { position: [-0.35, 0.82, 0.86], size: [0.85, 0.5, 0.06] },
  "door-front-right": {
    position: [-0.35, 0.82, -0.86],
    size: [0.85, 0.5, 0.06],
  },
  "door-rear-left": { position: [0.55, 0.82, 0.86], size: [0.85, 0.5, 0.06] },
  "door-rear-right": { position: [0.55, 0.82, -0.86], size: [0.85, 0.5, 0.06] },
  "fender-front-left": {
    position: [-1.42, 0.56, 0.83],
    size: [0.95, 0.36, 0.08],
  },
  "fender-front-right": {
    position: [-1.42, 0.56, -0.83],
    size: [0.95, 0.36, 0.08],
  },
  "fender-rear-left": {
    position: [1.35, 0.56, 0.83],
    size: [0.95, 0.36, 0.08],
  },
  "fender-rear-right": {
    position: [1.35, 0.56, -0.83],
    size: [0.95, 0.36, 0.08],
  },
  "headlight-left": { position: [-2.02, 0.72, 0.55], size: [0.08, 0.2, 0.32] },
  "headlight-right": {
    position: [-2.02, 0.72, -0.55],
    size: [0.08, 0.2, 0.32],
  },
  "taillight-left": { position: [2.02, 0.72, 0.55], size: [0.08, 0.2, 0.32] },
  "taillight-right": { position: [2.02, 0.72, -0.55], size: [0.08, 0.2, 0.32] },
  "mirror-left": { position: [-0.7, 0.98, 1.0], size: [0.14, 0.14, 0.1] },
  "mirror-right": { position: [-0.7, 0.98, -1.0], size: [0.14, 0.14, 0.1] },
  "wheel-front-left": {
    position: [-1.3, 0.34, 0.9],
    size: [0.24, 0.68, 0.68],
    shape: "wheel",
  },
  "wheel-front-right": {
    position: [-1.3, 0.34, -0.9],
    size: [0.24, 0.68, 0.68],
    shape: "wheel",
  },
  "wheel-rear-left": {
    position: [1.3, 0.34, 0.9],
    size: [0.24, 0.68, 0.68],
    shape: "wheel",
  },
  "wheel-rear-right": {
    position: [1.3, 0.34, -0.9],
    size: [0.24, 0.68, 0.68],
    shape: "wheel",
  },
};

const HUMAN_LABEL: Record<string, string> = {
  "front-bumper": "Front bumper",
  "rear-bumper": "Rear bumper",
  bonnet: "Bonnet / hood",
  roof: "Roof",
  radiator: "Radiator",
  windshield: "Windshield",
  "rear-window": "Rear window",
  "door-front-left": "Front left door",
  "door-front-right": "Front right door",
  "door-rear-left": "Rear left door",
  "door-rear-right": "Rear right door",
  "fender-front-left": "Front left fender",
  "fender-front-right": "Front right fender",
  "fender-rear-left": "Rear left fender",
  "fender-rear-right": "Rear right fender",
  "headlight-left": "Left headlight",
  "headlight-right": "Right headlight",
  "taillight-left": "Left tail light",
  "taillight-right": "Right tail light",
  "mirror-left": "Left mirror",
  "mirror-right": "Right mirror",
  "wheel-front-left": "Front left wheel",
  "wheel-front-right": "Front right wheel",
  "wheel-rear-left": "Rear left wheel",
  "wheel-rear-right": "Rear right wheel",
};

// A single mappable part. It colours itself from its finding (if any) and reports a
// click to the parent. Glass and wheels use different primitive geometry.
function Part({
  component,
  spec,
  color,
  selected,
  onSelect,
}: {
  component: string;
  spec: Spec;
  color: string;
  selected: boolean;
  onSelect?: (component: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const isWheel = spec.shape === "wheel";
  const isGlass = spec.shape === "glass";
  const geometry = isWheel ? (
    <cylinderGeometry
      args={[spec.size[2] / 2, spec.size[2] / 2, spec.size[0], 20]}
    />
  ) : (
    <boxGeometry args={spec.size} />
  );
  const rotation: [number, number, number] = isWheel
    ? [Math.PI / 2, 0, 0]
    : spec.rotation || [0, 0, 0];
  return (
    <mesh
      position={spec.position}
      rotation={rotation}
      onClick={(e) => {
        e.stopPropagation();
        onSelect?.(component);
      }}
      onPointerOver={(e) => {
        e.stopPropagation();
        setHover(true);
        document.body.style.cursor = "pointer";
      }}
      onPointerOut={() => {
        setHover(false);
        document.body.style.cursor = "auto";
      }}
    >
      {geometry}
      <meshStandardMaterial
        color={color}
        transparent={isGlass}
        opacity={isGlass ? 0.5 : 1}
        emissive={selected ? "#1e5aa8" : hover ? "#334155" : "#000000"}
        emissiveIntensity={selected ? 0.55 : hover ? 0.2 : 0}
      />
    </mesh>
  );
}

// Non-interactive chassis so the coloured panels sit on a recognisable body.
function Chassis() {
  return (
    <group>
      <mesh position={[0, 0.55, 0]}>
        <boxGeometry args={[3.7, 0.5, 1.6]} />
        <meshStandardMaterial color="#e7ebf0" />
      </mesh>
      <mesh position={[0.25, 1.05, 0]}>
        <boxGeometry args={[1.7, 0.55, 1.5]} />
        <meshStandardMaterial color="#eef1f5" />
      </mesh>
    </group>
  );
}

// Preset camera placements. The model is built nose-along -X, so the front view
// sits on the -X side. Values are camera coordinates; the rig looks at the body.
type ViewKey = "iso" | "front" | "rear" | "left" | "right" | "top";
const VIEW_POSITIONS: Record<ViewKey, [number, number, number]> = {
  iso: [4.6, 3.2, 5.6],
  front: [-6.4, 1.4, 0.001],
  rear: [6.4, 1.4, 0.001],
  left: [0.001, 1.3, 6.4],
  right: [0.001, 1.3, -6.4],
  top: [0, 7.5, 0.001],
};
const VIEW_LABELS: Record<ViewKey, string> = {
  iso: "Isometric",
  front: "Front",
  rear: "Rear",
  left: "Left",
  right: "Right",
  top: "Top",
};

// Moves the camera to the selected preset and re-aims OrbitControls at the body.
// Uses the default controls registered by <OrbitControls makeDefault />.
function CameraRig({ view }: { view: ViewKey }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    const p = VIEW_POSITIONS[view];
    camera.position.set(p[0], p[1], p[2]);
    const c = controls as unknown as {
      target: { set: (x: number, y: number, z: number) => void };
      update: () => void;
    } | null;
    if (c?.target && typeof c.update === "function") {
      c.target.set(0, 0.7, 0);
      c.update();
    } else {
      camera.lookAt(0, 0.7, 0);
    }
  }, [view, camera, controls]);
  return null;
}

export default function VehicleDamageViewer({
  findings,
  selectedComponent,
  onSelectComponent,
  viewState = "assessed",
  height = 380,
}: Props) {
  // Orbit/zoom/pan is handled natively by drei's OrbitControls (makeDefault), so
  // the previous hand-rolled pointer maths is gone.
  const [view, setView] = useState<ViewKey>("iso");
  const [highlight, setHighlight] = useState(true);

  const byComponent = useMemo(() => {
    const m: Record<string, ViewerFinding> = {};
    for (const f of findings)
      if (f.mappedTo3D && COMPONENT_SPECS[f.component]) m[f.component] = f;
    return m;
  }, [findings]);

  const colorFor = (component: string): string => {
    if (!highlight) return BASE_COLOR;
    if (viewState === "repaired") return SEVERITY_COLOR["no-visible-damage"];
    const f = byComponent[component];
    if (!f) return BASE_COLOR;
    return SEVERITY_COLOR[f.severity] || SEVERITY_COLOR.inconclusive;
  };

  const mappedCount = Object.keys(byComponent).length;

  return (
    <div>
      <div
        style={{
          position: "relative",
          height,
          borderRadius: 10,
          overflow: "hidden",
          background: "linear-gradient(160deg,#f4f7fb,#dbe4ee)",
          border: "1px solid #cbd5e1",
          touchAction: "none",
        }}
      >
        <Canvas camera={{ position: VIEW_POSITIONS.iso, fov: 42 }}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[5, 8, 5]} intensity={0.9} />
          <CameraRig view={view} />
          <group>
            <Chassis />
            {Object.entries(COMPONENT_SPECS).map(([component, spec]) => (
              <Part
                key={component}
                component={component}
                spec={spec}
                color={colorFor(component)}
                selected={selectedComponent === component}
                onSelect={onSelectComponent}
              />
            ))}
          </group>
          <OrbitControls
            makeDefault
            enablePan
            enableZoom
            enableRotate
            minDistance={3}
            maxDistance={14}
            target={[0, 0.7, 0]}
          />
        </Canvas>

        {/* Preset camera views - spec asks for front/rear/side plus rotate/zoom/pan. */}
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            display: "flex",
            gap: 4,
            flexWrap: "wrap",
            maxWidth: "68%",
          }}
        >
          {(Object.keys(VIEW_LABELS) as ViewKey[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              style={{
                fontSize: 11,
                padding: "3px 8px",
                borderRadius: 6,
                border: `1px solid ${view === v ? "#1e5aa8" : "#cbd5e1"}`,
                background: view === v ? "#1e5aa8" : "rgba(255,255,255,0.85)",
                color: view === v ? "#fff" : "#1e5aa8",
                cursor: "pointer",
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
        </div>

        {/* Original vs highlighted toggle (spec: "Original versus highlighted"). */}
        <button
          type="button"
          onClick={() => setHighlight((h) => !h)}
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            fontSize: 11,
            padding: "3px 10px",
            borderRadius: 6,
            border: "1px solid #cbd5e1",
            background: "#fff",
            color: "#1e5aa8",
            cursor: "pointer",
          }}
        >
          {highlight ? "Show neutral body" : "Highlight findings"}
        </button>

        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            fontSize: 11,
            color: "#475569",
            background: "rgba(255,255,255,0.75)",
            padding: "3px 8px",
            borderRadius: 6,
          }}
        >
          Drag to orbit · scroll to zoom · right-drag to pan · click a part to
          inspect
        </div>
      </div>

      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6 }}>
        {viewState === "repaired"
          ? "Repaired-state preview: every mapped part shown as if the approved plan were completed. This is a plan preview, not photographic evidence that the repair was done."
          : `${mappedCount} mapped component(s) carry a finding; unassessed parts are shown in neutral grey and are not claimed to be undamaged.`}
      </div>

      {/* Legend, so a colour is never left to guesswork. */}
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 10,
          marginTop: 8,
          fontSize: 12,
        }}
      >
        {Object.entries(SEVERITY_COLOR).map(([k, c]) => (
          <span
            key={k}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              color: "#475569",
            }}
          >
            <span
              style={{
                width: 12,
                height: 12,
                borderRadius: 3,
                background: c,
                display: "inline-block",
              }}
            />
            {HUMAN_LABEL[k] || k}
          </span>
        ))}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            color: "#475569",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: 3,
              background: BASE_COLOR,
              display: "inline-block",
            }}
          />
          Not assessed
        </span>
      </div>
    </div>
  );
}

export { HUMAN_LABEL as DAMAGE_COMPONENT_LABELS };
