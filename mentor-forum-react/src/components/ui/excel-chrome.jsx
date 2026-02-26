import React from 'react';

const DEFAULT_TABS = ['홈', '삽입', '페이지 레이아웃', '수식', '데이터', '검토', '보기'];
const DEFAULT_TOOLS = ['붙여넣기', '글꼴', '맞춤', '숫자', '스타일', '셀', '편집'];

function columnLabel(index) {
  let n = Math.max(1, Math.floor(index) + 1);
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return label;
}

function buildColumnHeaders(colCount) {
  const total = Math.max(1, Math.floor(Number(colCount) || 20));
  return Array.from({ length: total }, (_, i) => columnLabel(i));
}

function buildRowHeaders(rowCount) {
  const total = Math.max(1, Math.floor(Number(rowCount) || 40));
  return Array.from({ length: total }, (_, i) => String(i + 1));
}

export function ExcelSheetCorner() {
  return <div className="excel-sheet-corner" aria-hidden="true" />;
}

export function ExcelColumnHeaders({ colCount = 20 }) {
  const headers = buildColumnHeaders(colCount);
  return (
    <div className="excel-column-headers" aria-hidden="true">
      {headers.map((label) => (
        <span key={`excel-col-${label}`} className="excel-column-header">
          {label}
        </span>
      ))}
    </div>
  );
}

export function ExcelRowHeaders({ rowCount = 40 }) {
  const headers = buildRowHeaders(rowCount);
  return (
    <div className="excel-row-headers" aria-hidden="true">
      {headers.map((label) => (
        <span key={`excel-row-${label}`} className="excel-row-header">
          {label}
        </span>
      ))}
    </div>
  );
}

export function ExcelRibbon({ title = '통합 문서1', activeTab = '홈', compact = false }) {
  return (
    <header className="excel-ribbon" aria-hidden="true">
      <div className="excel-ribbon-titlebar">
        <span className="excel-ribbon-title">{title}</span>
      </div>
      <div className="excel-ribbon-tabs">
        {DEFAULT_TABS.map((tab) => (
          <span
            key={`excel-tab-${tab}`}
            className={tab === activeTab ? 'excel-ribbon-tab is-active' : 'excel-ribbon-tab'}
          >
            {tab}
          </span>
        ))}
      </div>
      <div className="excel-ribbon-tools">
        {(compact ? DEFAULT_TOOLS.slice(0, 4) : DEFAULT_TOOLS).map((tool) => (
          <span key={`excel-tool-${tool}`} className="excel-ribbon-tool">
            {tool}
          </span>
        ))}
      </div>
    </header>
  );
}

export function ExcelFormulaBar({ countLabel = '', activeCellLabel = '', formulaText = '' }) {
  return (
    <div className="excel-formula-bar" aria-hidden="true">
      <span className="excel-name-box">{activeCellLabel || '\u00A0'}</span>
      <span className="excel-fx-badge">fx</span>
      <span className="excel-formula-input">{formulaText || '='}</span>
      {countLabel ? <span className="excel-formula-count">{countLabel}</span> : null}
    </div>
  );
}

export function ExcelSheetTabs({ sheetName = 'Sheet1', compact = false }) {
  return (
    <div className="excel-sheet-tabs" aria-hidden="true">
      <span className="excel-sheet-nav">◂</span>
      <span className="excel-sheet-nav">▸</span>
      <span className="excel-sheet-nav">＋</span>
      <span className="excel-sheet-tab is-active">{sheetName}</span>
      {!compact ? (
        <>
          <span className="excel-sheet-tab">Sheet2</span>
          <span className="excel-sheet-tab">Sheet3</span>
          <span className="excel-sheet-tab">Sheet4</span>
        </>
      ) : null}
    </div>
  );
}

export function ExcelStatusBar({ compact = false }) {
  return (
    <div className="excel-status-bar" aria-hidden="true">
      <span className="excel-status-left">준비 · 접근성: 계속 진행 가능</span>
      <span className="excel-status-right">{compact ? '100%' : '-   ═══●═══   +   100%'}</span>
    </div>
  );
}

export function ExcelChrome({
  title = '통합 문서1',
  activeTab = '홈',
  sheetName = 'Sheet1',
  countLabel = '',
  activeCellLabel = '',
  formulaText = '',
  compact = false,
  showHeaders = true,
  rowCount = 40,
  colCount = 20
}) {
  return (
    <div className="excel-chrome" aria-hidden="true">
      <ExcelRibbon title={title} activeTab={activeTab} compact={compact} />
      <ExcelFormulaBar
        countLabel={countLabel}
        activeCellLabel={activeCellLabel}
        formulaText={formulaText}
      />
      {showHeaders ? <ExcelSheetCorner /> : null}
      {showHeaders ? <ExcelColumnHeaders colCount={colCount} /> : null}
      {showHeaders ? <ExcelRowHeaders rowCount={rowCount} /> : null}
      <ExcelSheetTabs sheetName={sheetName} compact={compact} />
      <ExcelStatusBar compact={compact} />
    </div>
  );
}
