import { formatRanges } from './tool-model.mjs';
/**
 * Builds the input controls of a tool from its descriptor (DOM only). Number and range controls keep the markup the
 * Viewer's mechanism panel always used: <label>text<input data-parameter="key" ...></label>.
 * `attribute` names the dataset key that carries the parameter key or config path ("parameter" or "path").
 */
export function renderControl(doc, spec, value, { attribute = 'parameter', key = spec.key ?? spec.path } = {}) {
  const label = doc.createElement('label');
  label.append(doc.createTextNode(spec.label));
  let input;
  if (spec.type === 'select') {
    input = doc.createElement('select');
    for (const option of spec.options) {
      const item = doc.createElement('option');
      item.value = option.value; item.textContent = option.label;
      input.append(item);
    }
    input.value = value ?? spec.default ?? spec.options[0].value;
  } else {
    input = doc.createElement('input');
    input.type = spec.type === 'number' ? (spec.control === 'range' ? 'range' : 'number') : spec.type === 'boolean' ? 'checkbox' : spec.type === 'color' ? 'color' : 'text';
    if (spec.type === 'number') for (const name of ['min', 'max', 'step']) input.setAttribute(name, String(spec[name]));
    if (spec.type === 'text' && spec.maxLength) input.setAttribute('maxlength', String(spec.maxLength));
    if (spec.type === 'boolean') input.checked = Boolean(value ?? spec.default);
    else input.value = spec.format === 'ranges' ? formatRanges(value) : value === null ? '' : String(value ?? spec.default ?? '');
  }
  input.dataset[attribute] = key;
  if (spec.unit) input.title = spec.unit;
  label.append(input);
  return label;
}

export function renderControls(doc, specs, values = {}, options = {}) {
  return specs.map((spec) => renderControl(doc, spec, values[spec.key ?? spec.path], options));
}

/** What an input element currently holds, as the raw value `coerceField` expects. */
export const readControl = (input) => input.type === 'checkbox' ? input.checked : input.value;

/** Shows `value` in an input element built by renderControl. */
export function writeControl(input, value) {
  if (input.type === 'checkbox') input.checked = Boolean(value);
  else input.value = value === null || value === undefined ? '' : String(value);
}
