// floorplan.js – husets planritning som schematisk geometri (beslut 33).
//
// Väggar och rum som polygoner med rumstyp som etikett (Sovrum, Kök …). Inga personnamn,
// inga Homey-ID, ingen adress och inga enheter. Kopplingen rum → Homey-zon görs i appen
// och sparas lokalt per webbläsare; samma etikett som en zon kopplas automatiskt om den
// är entydig.
//
// Koordinater i en egen enhet där husets innerbredd (6,25 m) är 663 enheter.
// kind: 'room' = kopplingsbart rum, 'aux' = garderob o.d. (ritas, kopplas inte).
// out: true = utomhusyta (egen ton). walls: null = ingen husvägg runt (fristående ytor).

export const FLOORS = Object.freeze([
  {
    id: 'f1',
    label: 'Entréplan',
    view: [76, 88, 734, 1400],
    walls: [88, 408, 710, 1060],
    areas: [
      { id: 'f1-altan', kind: 'room', out: true, label: 'Altan', pts: [[88, 100], [798, 100], [798, 404], [88, 404]], at: [443, 252] },
      { id: 'f1-vard', kind: 'room', label: 'Vardagsrum', pts: [[112, 432], [775, 432], [775, 745], [112, 745]], at: [443, 590] },
      { id: 'f1-kok', kind: 'room', label: 'Kök', sub: 'Matplats', pts: [[322, 745], [775, 745], [775, 1445], [458, 1445], [458, 1025], [322, 1025]], at: [615, 900] },
      { id: 'f1-trappa', kind: 'room', label: 'Trappa', pts: [[112, 745], [322, 745], [322, 855], [210, 855], [210, 962], [112, 962]], at: [160, 800] },
      { id: 'f1-forrad', kind: 'aux', label: 'Förråd', pts: [[210, 855], [322, 855], [322, 962], [210, 962]], at: [266, 910] },
      { id: 'f1-hall', kind: 'room', label: 'Hall', pts: [[322, 1025], [458, 1025], [458, 1445], [322, 1445]], at: [390, 1290] },
      { id: 'f1-g', kind: 'aux', label: '', pts: [[112, 972], [310, 972], [310, 1060], [112, 1060]], at: [211, 1016] },
      { id: 'f1-tvatt', kind: 'room', label: 'Tvättstuga', pts: [[112, 1060], [310, 1060], [310, 1225], [112, 1225]], at: [211, 1145] },
      { id: 'f1-bad', kind: 'room', label: 'Badrum', pts: [[112, 1232], [310, 1232], [310, 1445], [112, 1445]], at: [211, 1340] },
    ],
    // Inredning som tunna konturer (kök) – bara för orientering.
    fixtures: [
      [[455, 1028], [775, 1028], [775, 1100], [455, 1100]],
      [[712, 1100], [775, 1100], [775, 1385], [712, 1385]],
      [[545, 1385], [712, 1385], [712, 1445], [545, 1445]],
    ],
    entry: [380, 1468],
  },
  {
    id: 'f2',
    label: 'Övre plan',
    view: [100, 88, 734, 1088],
    walls: [112, 100, 710, 1062],
    areas: [
      { id: 'f2-sov1', kind: 'room', label: 'Sovrum', pts: [[136, 124], [462, 124], [462, 437], [136, 437]], at: [300, 280] },
      { id: 'f2-sov2', kind: 'room', label: 'Sovrum', pts: [[478, 124], [797, 124], [797, 437], [478, 437]], at: [637, 280] },
      { id: 'f2-trappa', kind: 'room', label: 'Trappa', pts: [[136, 445], [345, 445], [345, 650], [136, 650]], at: [240, 548] },
      { id: 'f2-allrum', kind: 'room', label: 'Allrum', pts: [[345, 445], [797, 445], [797, 742], [462, 742], [462, 856], [200, 856], [200, 742], [345, 742]], at: [590, 600] },
      { id: 'f2-g1', kind: 'aux', label: '', pts: [[136, 742], [200, 742], [200, 856], [136, 856]], at: [168, 800] },
      { id: 'f2-g2', kind: 'aux', label: '', pts: [[255, 678], [345, 678], [345, 742], [255, 742]], at: [300, 710] },
      { id: 'f2-bad', kind: 'room', label: 'Badrum', pts: [[136, 880], [322, 880], [322, 1138], [136, 1138]], at: [229, 1010] },
      { id: 'f2-g3', kind: 'aux', label: '', pts: [[345, 880], [440, 880], [440, 1138], [345, 1138]], at: [392, 1010] },
      { id: 'f2-sov3', kind: 'room', label: 'Sovrum', pts: [[440, 756], [752, 756], [752, 786], [797, 786], [797, 1138], [440, 1138]], at: [620, 950] },
    ],
    fixtures: [],
    entry: null,
  },
  {
    // Fristående ytor utomhus, schematiskt (inga mått eller lägen).
    id: 'f3',
    label: 'Utomhus',
    view: [0, 0, 734, 250],
    walls: null,
    areas: [
      { id: 'f3-fram', kind: 'room', out: true, label: 'Framsidan', pts: [[12, 20], [430, 20], [430, 230], [12, 230]], at: [221, 125] },
      { id: 'f3-forrad', kind: 'room', out: true, label: 'Förråd', pts: [[470, 20], [722, 20], [722, 230], [470, 230]], at: [596, 125] },
    ],
    fixtures: [],
    entry: null,
  },
]);

export function rooms() {
  return FLOORS.flatMap(f => f.areas.filter(a => a.kind === 'room').map(a => ({ ...a, floor: f.id })));
}

function norm(s) { return String(s || '').trim().toLocaleLowerCase('sv'); }

// Automatisk koppling: en ritad etikett som förekommer en gång i planen och exakt
// motsvarar ett appens rum (namnet på en Homey-zon eller ett eget rum) kopplas dit.
// Returnerar { areaId: roomId }.
export function autoMap(appRooms) {
  const out = {};
  const areas = rooms();
  const count = new Map();
  for (const a of areas) count.set(norm(a.label), (count.get(norm(a.label)) || 0) + 1);
  for (const a of areas) {
    if (count.get(norm(a.label)) !== 1) continue;
    const hit = appRooms.filter(r => norm(r.name) === norm(a.label));
    if (hit.length === 1) out[a.id] = hit[0].id;
  }
  return out;
}

// Etikettens mittpunkt för en polygon (för klick- och textplacering).
export function points(pts) {
  return pts.map(([x, y]) => `${x},${y}`).join(' ');
}
