/** Display style of the elements that occur in small molecules (classic: ELEMENTS in src/repr/palettes.js): colour and ball radius in Å. */
export const ELEMENT_STYLE = Object.freeze({
  C: ['#d9dee9', 0.58], N: ['#4f7dff', 0.58], O: ['#ff3b4e', 0.58], P: ['#ff9a1f', 0.75], S: ['#ffe14d', 0.55], H: ['#ffffff', 0.25],
  MG: ['#6dff9a', 0.9], K: ['#b98cff', 1.2], NA: ['#8ca6ff', 0.9], CA: ['#dfe6ff', 1.0], ZN: ['#9db0c8', 0.8], FE: ['#ff8c3d', 0.8],
  CL: ['#7dff7d', 0.9], MN: ['#c87dff', 0.8], CU: ['#ffb070', 0.8], F: ['#9dff9d', 0.4], BR: ['#c8641e', 0.6], I: ['#9d4dff', 0.7], SE: ['#ffa53d', 0.55],
});
const UNKNOWN = ['#ff7dff', 0.5];
export const elementStyle = (element) => ELEMENT_STYLE[String(element).toUpperCase()] ?? UNKNOWN;
