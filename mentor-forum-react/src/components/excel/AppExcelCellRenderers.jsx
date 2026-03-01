/**
 * App Excel 셀 메타 데이터를 화면 표현용 속성으로 정규화하는 유틸 모듈.
 * - 시트 모델이 어떤 형태로 넘어오더라도 렌더링 가능한 안전한 셀 형태를 보장한다.
 * - Workbook 컴포넌트는 이 모듈의 반환값만 신뢰하고 DOM class/style를 구성한다.
 */
function asText(value) {
  return String(value == null ? '' : value);
}

export function normalizeAppExcelCell(value) {
  if (!value || typeof value !== 'object') {
    // 데이터 누락 시에도 워크북이 깨지지 않도록 기본 셀 스키마를 강제한다.
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
  // Formula bar 노출용 텍스트는 formulaText를 우선하고, 없으면 display text를 사용한다.
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
    // 디자인 시스템에서 허용한 테두리 두께 범위(1~2px)로 클램프한다.
    borderTopWidth: `${Math.max(1, Math.min(2, cell.borderTop))}px`,
    borderRightWidth: `${Math.max(1, Math.min(2, cell.borderRight))}px`,
    borderBottomWidth: `${Math.max(1, Math.min(2, cell.borderBottom))}px`,
    borderLeftWidth: `${Math.max(1, Math.min(2, cell.borderLeft))}px`,
    '--merge-span': `${Math.max(1, cell.mergeAcross + 1)}`
  };
}
