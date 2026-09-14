// Paleta y color determinístico por materia, compartido entre el panel
// "Mis materias", la barra lateral y el encabezado de cada materia, para
// que el mismo curso siempre se vea con el mismo color en toda la app.
const PALETA_MATERIA = [
  ["#188038", "#0b6e2f"],
  ["#1a73e8", "#0b47a1"],
  ["#8430ce", "#5c1f96"],
  ["#e37400", "#b25800"],
  ["#d93025", "#a30000"],
  ["#00897b", "#00695c"],
  ["#3949ab", "#1a237e"],
  ["#00838f", "#005662"]
];

function colorMateria(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const [c1, c2] = PALETA_MATERIA[hash % PALETA_MATERIA.length];
  return `linear-gradient(135deg, ${c1} 0%, ${c2} 100%)`;
}

function colorSolidoMateria(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETA_MATERIA[hash % PALETA_MATERIA.length][0];
}
