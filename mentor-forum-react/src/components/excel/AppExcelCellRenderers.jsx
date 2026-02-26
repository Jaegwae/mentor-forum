function asText(value) {
  return String(value == null ? '' : value);
}

export function normalizeAppExcelCell(value) {
  if (!value || typeof value !== 'object') {
    return {
      kind: 'blank',
      text: '',
      surface: 'sheet',
      borderTop: 1,
      borderRight: 1,
      borderBottom: 1,
      borderLeft: 1,
      actionType: '',
      actionPayload: null,
      trigger: '',
      active: false,
      disabled: false,
      formulaText: '',
      mergeAcross: 0,
      mergeChild: false
    };
  }
  return {
    kind: asText(value.kind || 'text'),
    text: asText(value.text),
    surface: asText(value.surface || 'sheet'),
    borderTop: Number(value.borderTop) || 1,
    borderRight: Number(value.borderRight) || 1,
    borderBottom: Number(value.borderBottom) || 1,
    borderLeft: Number(value.borderLeft) || 1,
    actionType: asText(value.actionType),
    actionPayload: value.actionPayload ?? null,
    trigger: asText(value.trigger),
    active: value.active === true,
    disabled: value.disabled === true,
    formulaText: asText(value.formulaText || value.text || ''),
    mergeAcross: Math.max(0, Math.floor(Number(value.mergeAcross) || 0)),
    mergeChild: value.mergeChild === true
  };
}

export function getAppExcelCellText(value) {
  const cell = normalizeAppExcelCell(value);
  return asText(cell.formulaText || cell.text);
}

export function getAppExcelCellClassName(value) {
  const cell = normalizeAppExcelCell(value);
  const classes = [
    'app-excel-cell',
    `kind-${cell.kind || 'text'}`,
    `surface-${cell.surface || 'sheet'}`
  ];
  if (cell.active) classes.push('is-active');
  if (cell.disabled) classes.push('is-disabled');
  if (cell.actionType) classes.push('is-action');
  if (cell.mergeAcross > 0) classes.push('is-merged-parent');
  if (cell.mergeChild) classes.push('is-merged-child');
  return classes.join(' ');
}

export function getAppExcelCellStyle(value) {
  const cell = normalizeAppExcelCell(value);
  return {
    borderTopWidth: `${Math.max(1, Math.min(2, cell.borderTop))}px`,
    borderRightWidth: `${Math.max(1, Math.min(2, cell.borderRight))}px`,
    borderBottomWidth: `${Math.max(1, Math.min(2, cell.borderBottom))}px`,
    borderLeftWidth: `${Math.max(1, Math.min(2, cell.borderLeft))}px`,
    '--merge-span': `${Math.max(1, cell.mergeAcross + 1)}`
  };
}
