const PALETTES = {
  neon:     ['#e64fc8', '#5b9dff', '#3fc864', '#2448e8', '#f2f2f7', '#3fd0c0', '#ff9a50', '#9b7bff', '#f5e07a', '#ff5a6a', '#46b4ff', '#b8f05a'],
  pastel:   ['#f6a6c8', '#a6d8f6', '#b8eab0', '#c9b6f2', '#f8e3a3', '#9ee3d6', '#f7bfa0', '#d0d6e0', '#f2a6a6', '#a6b8f6'],
  goodsell: ['#e8a75c', '#7aa6d9', '#e57872', '#9cc77a', '#c79ad6', '#e6d27a', '#6fc4bd', '#d98fb0', '#b0b8c8', '#f0c090'],
};

/* element style for small molecules: colour, ball radius (A, before "小分子大小"), covalent radius */
const ELEMENTS = {
  C: ['#d9dee9', 0.58, 0.76], N: ['#4f7dff', 0.58, 0.71], O: ['#ff3b4e', 0.58, 0.66], P: ['#ff9a1f', 0.75, 1.07],
  S: ['#ffe14d', 0.55, 1.05], H: ['#ffffff', 0.25, 0.31], MG: ['#6dff9a', 0.9, 0], K: ['#b98cff', 1.2, 0], NA: ['#8ca6ff', 0.9, 0],
  CA: ['#dfe6ff', 1.0, 0], ZN: ['#9db0c8', 0.8, 0], FE: ['#ff8c3d', 0.8, 1.3], CL: ['#7dff7d', 0.9, 0], MN: ['#c87dff', 0.8, 0],
  CU: ['#ffb070', 0.8, 0], F: ['#9dff9d', 0.4, 0.57], BR: ['#c8641e', 0.6, 1.2], I: ['#9d4dff', 0.7, 1.39], SE: ['#ffa53d', 0.55, 1.2],
};
const elStyle = (el) => ELEMENTS[el] || ['#ff7dff', 0.5, 0.8];
const IGNORE_LIGANDS = new Set(['HOH', 'WAT', 'DOD', 'UNX', 'UNL']);

