// AdminPage presentation component.
// The controller handles permission checks and side-effects; this file renders
// admin UI and dispatches intent through controller handlers.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutPanelTop, LogOut, MapPin, MessageSquare, ShieldCheck, ShieldPlus, UsersRound } from 'lucide-react';
import { usePageMeta } from '../../hooks/usePageMeta.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '../../components/ui/select.jsx';
import { ThemeToggle } from '../../components/ui/theme-toggle.jsx';
import { ExcelChrome } from '../../components/ui/excel-chrome.jsx';
import { AppExcelWorkbook } from '../../components/excel/AppExcelWorkbook.jsx';
import {
  EXCEL_STANDARD_COL_COUNT,
  EXCEL_STANDARD_ROW_COUNT,
  buildAdminExcelSheetModel
} from '../../components/excel/secondary-excel-sheet-models.js';
import { useTheme } from '../../hooks/useTheme.js';
import {
  auth,
  db,
  ensureFirebaseConfigured,
  onAuthStateChanged,
  getTemporaryLoginRemainingMs,
  setTemporaryLoginExpiry,
  TEMP_LOGIN_TTL_MS,
  clearTemporaryLoginExpiry,
  enforceTemporaryLoginExpiry,
  signOut,
  serverTimestamp,
  deleteField,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  getDocs,
  deleteDoc,
  writeBatch
} from '../../legacy/firebase-app.js';
import { MENTOR_FORUM_CONFIG } from '../../legacy/config.js';
import {
  buildPermissions,
  roleDisplay,
  getRoleBadgePalette,
  normalizeBadgeColor
} from '../../legacy/rbac.js';
import * as pageConstants from './constants.js';
import * as pageUtils from './utils.js';

const {
  AUTO_LOGOUT_MESSAGE,
  DEFAULT_VENUE_LABELS,
  WORK_SCHEDULE_BOARD_ID,
  roleFlagDefs,
  ROLE_KEY_ALIASES,
  ROLE_COLOR_PRESETS,
  coreRoleDefaults,
  CORE_ROLE_SET,
  legacyRoleVisibilityCleanup
} = pageConstants;

const {
  normalizeText,
  sanitizeRoleKey,
  detectCompactListMode,
  shouldLogDebugPayload,
  isPermissionDeniedError,
  joinDebugParts,
  debugCodePoints,
  debugValueList,
  normalizeNickname,
  buildNicknameKey,
  normalizeVenueLabel,
  sortVenueOptions,
  timestampToMs,
  normalizeRoles,
  isCoreRole,
  roleDeleteLockedForAdmin,
  formatTemporaryLoginRemaining,
  createRoleDefMap,
  normalizeRoleKey,
  roleLevelWithDefinitions,
  sortRolesForManage,
  sortUsersForManage,
  isDividerItem,
  dividerLabel,
  boardSortValue,
  sortBoardItems,
  initRoleFlags,
  buildRoleFlagsFromDoc,
  buildManageState,
  roleSummaryText
} = pageUtils;

function RoleBadge({ role, roleDefinition = null }) {
  const roleKey = normalizeText(role) || 'Newbie';
  const def = roleDefinition || null;
  const palette = getRoleBadgePalette(roleKey, def);
  const label = def?.labelKo || roleKey;

  return (
    <span
      className="role-badge"
      style={{
        background: palette.bgColor,
        color: palette.textColor,
        borderColor: palette.borderColor
      }}
    >
      {label}
    </span>
  );
}

function RoleColorField({ id, label, value, disabled = false, onChange }) {
  const safeValue = normalizeBadgeColor(value, '#ffffff');
  return (
    <label>
      {label}
      <div className="role-color-field">
        <input
          id={id}
          type="text"
          value={safeValue}
          placeholder="#ffffff"
          maxLength={7}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
        />
        <span className="role-color-preview" style={{ backgroundColor: safeValue }} aria-hidden="true" />
      </div>
      <div className="role-color-palette">
        {ROLE_COLOR_PRESETS.map((color) => (
          <button
            key={`${id}-preset-${color}`}
            type="button"
            className={safeValue === color ? 'role-color-chip is-active' : 'role-color-chip'}
            style={{ backgroundColor: color }}
            disabled={disabled}
            aria-label={`${label} ${color}`}
            title={color}
            onClick={() => onChange(color)}
          />
        ))}
      </div>
    </label>
  );
}


function AdminModal({ modalId, open, onClose, panelClassName = 'admin-modal-panel', children }) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          id={modalId}
          className="admin-modal"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
        >
          <motion.div
            className="admin-modal-backdrop"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          />
          <motion.section
            className={`card ${panelClassName}`}
            initial={{ opacity: 0, y: 36, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 26, scale: 0.985 }}
            transition={{ type: 'spring', stiffness: 320, damping: 30, mass: 0.72 }}
          >
            {children}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}


export function AdminPageView({ vm }) {
  // Keep this list in sync with the controller return contract.
  // Explicit bindings help catch missing VM fields during refactors.
  const {
    navigate,
    theme,
    toggleTheme,
    isExcel,
    compactListMode,
    setCompactListMode,
    expiryTimerRef,
    countdownTimerRef,
    lastActivityRefreshAtRef,
    appliedPopupTimerRef,
    draggingBoardItemIdRef,
    ready,
    setReady,
    message,
    setMessage,
    appliedPopup,
    setAppliedPopup,
    currentUser,
    setCurrentUser,
    currentUserProfile,
    setCurrentUserProfile,
    permissions,
    setPermissions,
    sessionRemainingMs,
    setSessionRemainingMs,
    roleDefinitions,
    setRoleDefinitions,
    activeEditRoleKey,
    setActiveEditRoleKey,
    createRoleForm,
    setCreateRoleForm,
    editRoleForm,
    setEditRoleForm,
    boardItems,
    setBoardItems,
    activeEditBoardId,
    setActiveEditBoardId,
    createBoardForm,
    setCreateBoardForm,
    editBoardForm,
    setEditBoardForm,
    allUserRows,
    setAllUserRows,
    userSearch,
    setUserSearch,
    userDrafts,
    setUserDrafts,
    syncingNicknameIndex,
    setSyncingNicknameIndex,
    venueOptions,
    setVenueOptions,
    venueDrafts,
    setVenueDrafts,
    newVenueLabel,
    setNewVenueLabel,
    creatingVenue,
    setCreatingVenue,
    savingVenueId,
    setSavingVenueId,
    deletingVenueId,
    setDeletingVenueId,
    boardEditOpen,
    setBoardEditOpen,
    boardCreateOpen,
    setBoardCreateOpen,
    roleEditOpen,
    setRoleEditOpen,
    roleCreateOpen,
    setRoleCreateOpen,
    roleDefMap,
    sortedRoles,
    editableRoles,
    boardRows,
    anyModalOpen,
    isSuperAdminUser,
    myRoleLevel,
    clearMessage,
    pushMessage,
    showAppliedPopup,
    roleLevelOf,
    evaluateUserManageState,
    getBoardRoleChoices,
    defaultBoardRoles,
    filteredUsers,
    clearExpiryTimer,
    clearCountdownTimer,
    handleTemporaryLoginExpiry,
    scheduleTemporaryLoginExpiry,
    hasTemporarySession,
    refreshRoles,
    refreshBoards,
    refreshUsers,
    refreshVenueOptions,
    ensureDefaultVenueOptions,
    backfillNicknameIndex,
    handleExtendSession,
    handleLogout,
    ensurePermission,
    nextBoardSortOrder,
    persistBoardOrder,
    reorderBoardItems,
    openBoardEditModal,
    openBoardCreateModal,
    openRoleEditModal,
    openRoleCreateModal,
    closeModalById,
    saveCreateBoard,
    saveEditBoard,
    removeBoard,
    addBoardDivider,
    removeBoardDivider,
    saveCreateRole,
    saveEditRole,
    removeRole,
    seedCoreRoles,
    saveUserRole,
    createVenueOption,
    saveVenueOption,
    deleteVenueOption,
    canManageBoards,
    canManageRoleDefinitions,
    canManageRoles,
    adminNickname,
    adminRoleText,
    createRoleBadgePalette,
    editRoleBadgePalette,
    editRoleDoc,
    editRoleDeleteDisabled,
    sortedRoleOptionsForSelect,
    boardCount,
    venueCount,
    excelBoardRows,
    excelVenueRows,
    excelRoleRows,
    excelUserRows,
    excelSheetModel,
    isExcelDesktopMode,
    excelActiveCellLabel,
    setExcelActiveCellLabel,
    excelFormulaText,
    setExcelFormulaText,
    handleExcelSelectCell,
    handleExcelAction
  } = vm;

  return (
    <>
      {isExcel ? (
        <ExcelChrome
          title="통합 문서1"
          activeTab="홈"
          sheetName="Sheet1"
          countLabel={`${boardCount}개`}
          activeCellLabel={isExcelDesktopMode ? excelActiveCellLabel : ''}
          formulaText={isExcelDesktopMode ? excelFormulaText : '='}
          showHeaders
          rowCount={EXCEL_STANDARD_ROW_COUNT}
          colCount={EXCEL_STANDARD_COL_COUNT}
          compact={compactListMode}
        />
      ) : null}
      <motion.main
        className={isExcel ? 'page stack admin-shell excel-chrome-offset' : 'page stack admin-shell'}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
      >
        {isExcelDesktopMode ? (
          <AppExcelWorkbook
            sheetRows={excelSheetModel.rowData}
            rowCount={excelSheetModel.rowCount}
            colCount={excelSheetModel.colCount}
            onSelectCell={handleExcelSelectCell}
            onMoveHome={() => navigate(MENTOR_FORUM_CONFIG.app.appPage)}
            onToggleTheme={toggleTheme}
            onLogout={() => handleLogout().catch(() => {})}
            onAction={handleExcelAction}
          />
        ) : null}
        <div className={isExcelDesktopMode ? 'hidden' : ''}>
        <section className="card admin-hero">
          <div className="row space-between mobile-col">
            <div>
              <p className="hero-kicker"><ShieldCheck size={15} /> Operations Center</p>
              <h1>관리자 사이트</h1>
              <p className="muted hero-copy" style={{ marginTop: '6px' }}>Admin / Super_Admin 권한 관리 화면</p>
            </div>
            <div className="row top-action-row">
              <ThemeToggle />
            </div>
          </div>

          <div id="message" className={message.text ? (message.type === 'error' ? 'error' : 'notice') : 'hidden'} style={{ marginTop: '12px' }}>
            {message.text}
          </div>
        </section>

        <section className="admin-content-shell">
          <aside className="admin-side-rail" aria-label="관리자 내 정보">
            <section className="admin-side-profile">
              <p className="admin-side-kicker">내 정보</p>
              <div className="admin-side-user">
                <p className="author-name">{adminNickname}</p>
                <p className="meta admin-side-role">{adminRoleText}</p>
              </div>

              {sessionRemainingMs != null ? (
                <div className="admin-side-session">
                  <span className="session-ttl-label">
                    자동 로그아웃까지 <strong className="session-ttl-time">{formatTemporaryLoginRemaining(sessionRemainingMs)}</strong>
                  </span>
                  <button type="button" className="session-extend-btn" onClick={handleExtendSession}>연장</button>
                </div>
              ) : null}

              <div className="admin-side-actions">
                <button className="board-rail-profile-btn" type="button" onClick={() => navigate(MENTOR_FORUM_CONFIG.app.appPage)}>
                  <MessageSquare size={14} />
                  포럼으로
                </button>
                <button id="logoutBtn" className="board-rail-profile-btn is-logout" type="button" onClick={() => handleLogout().catch(() => {})}>
                  <LogOut size={14} />
                  로그아웃
                </button>
              </div>
            </section>
          </aside>

          <div className="admin-main-column">
            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><LayoutPanelTop size={18} /> 게시판 관리</h2>
            <div className="row mobile-wrap">
              <span id="boardCountBadge" className="badge">{boardCount}개</span>
              <button id="refreshBoardsBtn" className="btn-muted" type="button" onClick={() => refreshBoards().then(() => pushMessage('게시판 목록을 새로고침했습니다.', 'notice')).catch((err) => pushMessage(err?.message || '새로고침 실패', 'error'))}>
                새로고침
              </button>
              <button id="openBoardEditModalBtn" className="btn-primary" type="button" onClick={openBoardEditModal} disabled={!canManageBoards}>
                게시판 수정
              </button>
              <button id="openBoardCreateModalBtn" className="btn-primary" type="button" onClick={openBoardCreateModal} disabled={!canManageBoards}>
                게시판 생성
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>목록에서 확인하고 모달에서 수정/생성합니다.</p>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-board-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>이름</th>
                  <th>설명</th>
                  <th>허용 등급</th>
                </tr>
              </thead>
              <tbody id="boardTableBody">
                {!boardRows.length ? (
                  <tr>
                    <td colSpan={4} className="muted">게시판이 없습니다.</td>
                  </tr>
                ) : boardRows.map((row) => (
                  <tr key={row.id}>
                    <td><span className="text-ellipsis-1" title={row.id}>{row.id}</span></td>
                    <td><span className="text-ellipsis-1" title={row.name || '-'}>{row.name || '-'}</span></td>
                    <td><span className="text-ellipsis-2 break-anywhere" title={row.description || '-'}>{row.description || '-'}</span></td>
                    <td>
                        <span className="break-anywhere" title={Array.isArray(row.allowedRoles) ? row.allowedRoles.join(', ') : '-'}>
                          {Array.isArray(row.allowedRoles) ? row.allowedRoles.join(', ') : '-'}
                        </span>
                      </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><MapPin size={18} /> 체험관</h2>
            <div className="row mobile-wrap">
              <span className="badge">{venueCount}개</span>
              <button
                id="refreshVenuesBtn"
                className="btn-muted"
                type="button"
                onClick={() => refreshVenueOptions().then(() => pushMessage('체험관을 새로고침했습니다.', 'notice')).catch((err) => pushMessage(err?.message || '체험관 새로고침 실패', 'error'))}
              >
                새로고침
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>
            대체근무 작성 폼의 체험관 드롭다운에 표시되는 항목입니다. "직접작성"은 자동으로 함께 제공됩니다.
          </p>

          <form className="row admin-venue-create-row" style={{ marginTop: '10px' }} onSubmit={createVenueOption}>
            <input
              type="text"
              className="admin-venue-create-input"
              placeholder="예: 구로, 경기도서관"
              value={newVenueLabel}
              maxLength={30}
              onChange={(event) => setNewVenueLabel(event.target.value)}
              disabled={!canManageBoards || creatingVenue}
            />
            <button
              type="submit"
              className="btn-primary admin-venue-create-btn"
              disabled={!canManageBoards || creatingVenue}
            >
              {creatingVenue ? '추가 중...' : '체험관 추가'}
            </button>
          </form>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-board-table">
              <thead>
                <tr>
                  <th style={{ width: '80px' }}>번호</th>
                  <th>체험관 이름</th>
                  <th style={{ width: '220px' }}>작업</th>
                </tr>
              </thead>
              <tbody>
                {!venueOptions.length ? (
                  <tr>
                    <td colSpan={3} className="muted">등록된 체험관이 없습니다.</td>
                  </tr>
                ) : venueOptions.map((row, index) => (
                  <tr key={row.id}>
                    <td>{index + 1}</td>
                    <td>
                      <input
                        type="text"
                        maxLength={30}
                        value={venueDrafts[row.id]?.label || ''}
                        disabled={!canManageBoards}
                        onChange={(event) => {
                          const nextLabel = event.target.value;
                          setVenueDrafts((prev) => ({
                            ...prev,
                            [row.id]: { label: nextLabel }
                          }));
                        }}
                      />
                    </td>
                    <td>
                      <div className="row mobile-wrap">
                        <button
                          type="button"
                          className="btn-primary"
                          disabled={!canManageBoards || savingVenueId === row.id}
                          onClick={() => saveVenueOption(row.id).catch((err) => pushMessage(err?.message || '체험관 저장 실패', 'error'))}
                        >
                          {savingVenueId === row.id ? '저장 중...' : '저장'}
                        </button>
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={!canManageBoards || deletingVenueId === row.id}
                          onClick={() => deleteVenueOption(row.id).catch((err) => pushMessage(err?.message || '체험관 삭제 실패', 'error'))}
                        >
                          {deletingVenueId === row.id ? '삭제 중...' : '삭제'}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <h2 className="section-title"><ShieldPlus size={18} /> 등급(Role) 정의</h2>
            <div className="row mobile-wrap">
              <button id="openRoleEditModalBtn" className="btn-primary" type="button" onClick={openRoleEditModal} disabled={!canManageRoleDefinitions}>
                등급 수정
              </button>
              <button id="openRoleCreateModalBtn" className="btn-primary" type="button" onClick={openRoleCreateModal} disabled={!canManageRoleDefinitions}>
                등급 생성
              </button>
              <button
                id="seedRolesBtn"
                type="button"
                className={isSuperAdminUser ? 'btn-muted' : 'btn-muted hidden'}
                onClick={() => seedCoreRoles().catch((err) => pushMessage(err?.message || '기본 Role 적용 실패', 'error'))}
                disabled={!isSuperAdminUser}
              >
                기본 Role 적용
              </button>
            </div>
          </div>
          <p className="meta" style={{ marginTop: '6px' }}>기본 등급(Newbie, Mentor, Admin, Super_Admin)은 삭제할 수 없습니다.</p>
          <p className="meta" style={{ marginTop: '4px' }}>게시판 읽기/쓰기/댓글 가능 여부는 게시판 허용 등급(allowedRoles) 기준으로 동작합니다.</p>

          <div className="table-wrap" style={{ marginTop: '10px' }}>
            <table className="table admin-role-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>표시명</th>
                  <th>Level</th>
                  <th>배지</th>
                  <th>삭제 잠금</th>
                  <th>권한 요약</th>
                </tr>
              </thead>
              <tbody id="roleTableBody">
                {!sortedRoles.length ? (
                  <tr>
                    <td colSpan={6} className="muted">Role 정의가 없습니다.</td>
                  </tr>
                ) : sortedRoles.map((roleDoc) => {
                  const level = roleLevelWithDefinitions(roleDoc.role, roleDefinitions);
                  const lockText = isCoreRole(roleDoc.role)
                    ? '기본'
                    : roleDeleteLockedForAdmin(roleDoc)
                      ? 'Admin 삭제 불가'
                      : '해제';

                  return (
                    <tr key={roleDoc.role}>
                      <td><span className="text-ellipsis-1" title={roleDoc.role}>{roleDoc.role}</span></td>
                      <td><span className="text-ellipsis-1" title={roleDoc.labelKo || '-'}>{roleDoc.labelKo || '-'}</span></td>
                      <td>{level || '-'}</td>
                      <td><RoleBadge role={roleDoc.role} roleDefinition={roleDoc} /></td>
                      <td>{lockText}</td>
                      <td>
                        <span className="break-anywhere" title={roleSummaryText(roleDoc) || '-'}>
                          {roleSummaryText(roleDoc) || '-'}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </section>

            <section className="card admin-panel">
          <div className="row space-between mobile-col">
            <div>
              <h2 className="section-title"><UsersRound size={18} /> 회원 등급 변경</h2>
              <p className="meta" style={{ marginTop: '6px' }}>본인/동급/상위 등급은 변경할 수 없습니다.</p>
            </div>
            <div className="row mobile-wrap user-search-row">
              <input
                id="userSearchInput"
                className="admin-user-search-input"
                type="search"
                placeholder="이메일 또는 이름 검색"
                value={userSearch}
                onChange={(event) => setUserSearch(event.target.value)}
              />
              <button id="refreshUsersBtn" className="btn-muted" type="button" onClick={() => refreshUsers().catch((err) => pushMessage(err?.message || '회원 목록 새로고침 실패', 'error'))}>
                새로고침
              </button>
              <button
                id="syncNicknameIndexBtn"
                className="btn-muted"
                type="button"
                onClick={() => backfillNicknameIndex().catch((err) => pushMessage(err?.message || '닉네임 인덱스 동기화 실패', 'error'))}
                disabled={syncingNicknameIndex || !canManageRoles}
              >
                {syncingNicknameIndex ? '동기화 중...' : '닉네임 인덱스 동기화'}
              </button>
            </div>
          </div>

          <div className="table-wrap user-role-table-wrap" style={{ marginTop: '10px' }}>
            <table className="table user-role-table">
              <thead>
                <tr>
                  <th>이메일</th>
                  <th>이름</th>
                  <th>현재 등급</th>
                  <th>변경 등급</th>
                  <th>상태</th>
                  <th>적용</th>
                </tr>
              </thead>
              <tbody id="userTableBody">
                {!filteredUsers.length ? (
                  <tr>
                    <td colSpan={6} className="muted">검색 결과가 없습니다.</td>
                  </tr>
                ) : filteredUsers.map((userRow) => {
                  const currentRole = normalizeText(userRow.role) || 'Newbie';
                  const draft = userDrafts[userRow.uid] || {
                    role: currentRole
                  };

                  const baseState = evaluateUserManageState(userRow.uid, currentRole, draft.role);
                  const roleChanged = normalizeText(draft.role) !== currentRole;

                  let finalState = baseState;
                  if (baseState.type === 'ok' && !roleChanged) {
                    finalState = buildManageState('warn', '변경 없음');
                  }

                  const canEditRole = baseState.type !== 'lock';
                  const canSave = finalState.type === 'ok';

                  return (
                    <tr key={userRow.uid} data-user-id={userRow.uid}>
                      <td>
                        <span className="text-ellipsis-2 break-anywhere" title={userRow.email || '-'}>
                          {userRow.email || '-'}
                        </span>
                      </td>
                      <td>
                        <div className="user-name-cell">
                          <strong className="text-ellipsis-1" title={userRow.realName || '-'}>{userRow.realName || '-'}</strong>
                          <span className="meta text-ellipsis-1" title={userRow.nickname ? `@${userRow.nickname}` : '-'}>{userRow.nickname ? `@${userRow.nickname}` : '-'}</span>
                        </div>
                      </td>
                      <td><RoleBadge role={currentRole} roleDefinition={roleDefMap.get(currentRole) || null} /></td>
                      <td>
                        <Select
                          value={draft.role}
                          disabled={!canEditRole}
                          onValueChange={(value) => {
                            const nextValue = normalizeText(value) || 'Newbie';
                            setUserDrafts((prev) => ({
                              ...prev,
                              [userRow.uid]: {
                                role: nextValue
                              }
                            }));
                          }}
                        >
                          <SelectTrigger className="user-role-select">
                            <SelectValue placeholder="등급 선택" />
                          </SelectTrigger>
                          <SelectContent>
                            {sortedRoleOptionsForSelect.map((option) => (
                              <SelectItem key={`${userRow.uid}-${option.value}`} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td>
                        <span data-manage-state className={`user-state-badge ${finalState.className}`}>{finalState.label}</span>
                      </td>
                      <td>
                        <button
                          type="button"
                          data-action="save-user-role"
                          className="btn-primary"
                          disabled={!canSave || !canManageRoles}
                          onClick={() => saveUserRole(userRow).catch((err) => pushMessage(err?.message || '회원 권한 변경 실패', 'error'))}
                        >
                          적용
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
            </section>
          </div>
        </section>
        </div>
      </motion.main>

      <AdminModal
        modalId="boardEditModal"
        open={boardEditOpen}
        onClose={() => closeModalById('boardEditModal')}
        panelClassName="admin-modal-panel board-edit-modal-panel"
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>게시판 수정</h3>
              <p className="meta" style={{ marginTop: '6px' }}>게시판을 선택하고 이름/설명/허용 등급을 수정합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="boardEditModal"
              onClick={() => closeModalById('boardEditModal')}
            >
              닫기
            </button>
          </div>

          <div className="grid grid-2 board-edit-layout" style={{ marginTop: '12px' }}>
            <div className="board-edit-list-wrap">
              <div className="row space-between board-edit-toolbar">
                <p className="meta" style={{ margin: 0 }}>게시판 목록 (드래그 순서 변경)</p>
                <button id="addBoardDividerBtn" type="button" onClick={() => addBoardDivider().catch((err) => pushMessage(err?.message || '구분선 추가 실패', 'error'))} disabled={!canManageBoards}>
                  구분선 추가
                </button>
              </div>

              <div id="boardEditList" className="board-edit-list">
                {!boardItems.length ? (
                  <p className="muted" style={{ margin: 0 }}>게시판/구분선이 없습니다.</p>
                ) : boardItems.map((item) => {
                  const activeClass = item.id === activeEditBoardId ? ' active' : '';
                  const draggable = canManageBoards;

                  if (isDividerItem(item)) {
                    return (
                      <div
                        key={item.id}
                        className="board-edit-item board-divider-item"
                        data-item-id={item.id}
                        draggable={draggable}
                        onDragStart={(event) => {
                          if (!canManageBoards) return;
                          draggingBoardItemIdRef.current = item.id;
                          if (event.dataTransfer) {
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', item.id);
                          }
                        }}
                        onDragOver={(event) => {
                          if (!canManageBoards) return;
                          const draggingId = draggingBoardItemIdRef.current;
                          if (!draggingId || draggingId === item.id) return;
                          event.preventDefault();
                        }}
                        onDrop={(event) => {
                          if (!canManageBoards) return;
                          event.preventDefault();
                          const draggingId = draggingBoardItemIdRef.current;
                          draggingBoardItemIdRef.current = '';
                          if (!draggingId || draggingId === item.id) return;
                          reorderBoardItems(draggingId, item.id).catch((err) => pushMessage(err?.message || '정렬 반영 실패', 'error'));
                        }}
                        onDragEnd={() => {
                          draggingBoardItemIdRef.current = '';
                        }}
                      >
                        <div className="board-divider-view">
                          <span className="board-divider-line" />
                          <strong>{dividerLabel(item)}</strong>
                          <span className="meta board-divider-tag">구분선</span>
                        </div>
                        {canManageBoards ? (
                          <button
                            type="button"
                            className="board-divider-delete"
                            data-action="delete-divider"
                            onClick={async (event) => {
                              event.stopPropagation();
                              removeBoardDivider(item).catch((err) => pushMessage(err?.message || '구분선 삭제 실패', 'error'));
                            }}
                          >
                            삭제
                          </button>
                        ) : null}
                      </div>
                    );
                  }

                  return (
                    <div
                      key={item.id}
                      className={`board-edit-item${activeClass}`}
                      data-item-id={item.id}
                      draggable={draggable}
                      onDragStart={(event) => {
                        if (!canManageBoards) return;
                        draggingBoardItemIdRef.current = item.id;
                        if (event.dataTransfer) {
                          event.dataTransfer.effectAllowed = 'move';
                          event.dataTransfer.setData('text/plain', item.id);
                        }
                      }}
                      onDragOver={(event) => {
                        if (!canManageBoards) return;
                        const draggingId = draggingBoardItemIdRef.current;
                        if (!draggingId || draggingId === item.id) return;
                        event.preventDefault();
                      }}
                      onDrop={(event) => {
                        if (!canManageBoards) return;
                        event.preventDefault();
                        const draggingId = draggingBoardItemIdRef.current;
                        draggingBoardItemIdRef.current = '';
                        if (!draggingId || draggingId === item.id) return;
                        reorderBoardItems(draggingId, item.id).catch((err) => pushMessage(err?.message || '정렬 반영 실패', 'error'));
                      }}
                      onDragEnd={() => {
                        draggingBoardItemIdRef.current = '';
                      }}
                    >
                      <button
                        type="button"
                        className="board-edit-select"
                        data-board-id={item.id}
                        onClick={() => {
                          setActiveEditBoardId(item.id);
                          setEditBoardForm({
                            id: item.id,
                            name: item.name || '',
                            description: item.description || '',
                            allowedRoles: normalizeRoles(item.allowedRoles)
                          });
                        }}
                      >
                        <div><strong>{item.name || item.id}</strong></div>
                        <div className="meta" style={{ marginTop: '4px' }}>ID: {item.id}</div>
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            <form id="editBoardForm" className="stack" onSubmit={saveEditBoard}>
              <label>
                게시판 ID
                <input id="editBoardId" type="text" readOnly value={editBoardForm.id} disabled />
              </label>
              <p className="meta lock-hint-text">게시판 ID는 생성 후 변경할 수 없습니다.</p>
              <label>
                게시판 이름
                <input
                  id="editBoardName"
                  type="text"
                  required
                  value={editBoardForm.name}
                  onChange={(event) => setEditBoardForm((prev) => ({ ...prev, name: event.target.value }))}
                  disabled={!canManageBoards || !editBoardForm.id}
                />
              </label>
              <label>
                설명
                <input
                  id="editBoardDescription"
                  type="text"
                  placeholder="간단 설명"
                  value={editBoardForm.description}
                  onChange={(event) => setEditBoardForm((prev) => ({ ...prev, description: event.target.value }))}
                  disabled={!canManageBoards || !editBoardForm.id}
                />
              </label>
              <div className="board-role-box">
                <p className="meta" style={{ margin: '0 0 6px' }}>이용 가능 등급</p>
                <div id="editBoardRoleList" className="row board-role-list">
                  {!editBoardForm.id ? (
                    <p className="muted" style={{ margin: 0 }}>게시판을 선택하세요.</p>
                  ) : getBoardRoleChoices(editBoardForm.allowedRoles).map((item) => (
                    <label
                      key={`edit-board-role-${item.role}`}
                      className={`row board-role-option${item.checked ? ' is-selected' : ''}${!canManageBoards ? ' is-disabled' : ''}`}
                    >
                      <input
                        type="checkbox"
                        value={item.role}
                        checked={item.checked}
                        disabled={!canManageBoards}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setEditBoardForm((prev) => {
                            const selectedSet = new Set(normalizeRoles(prev.allowedRoles));
                            if (checked) selectedSet.add(item.role);
                            else selectedSet.delete(item.role);
                            return { ...prev, allowedRoles: [...selectedSet] };
                          });
                        }}
                      />
                      <span>{item.role}({item.labelKo}){item.extra ? ' *' : ''}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button
                  id="deleteBoardBtn"
                  type="button"
                  className={isSuperAdminUser && editBoardForm.id !== WORK_SCHEDULE_BOARD_ID ? 'btn-danger' : 'btn-danger hidden'}
                  disabled={!canManageBoards || !editBoardForm.id || !isSuperAdminUser || editBoardForm.id === WORK_SCHEDULE_BOARD_ID}
                  onClick={() => removeBoard().catch((err) => pushMessage(err?.message || '게시판 삭제 실패', 'error'))}
                >
                  삭제
                </button>
                <button type="submit" className="btn-primary" disabled={!canManageBoards || !editBoardForm.id}>저장</button>
              </div>
            </form>
          </div>
      </AdminModal>

      <AdminModal
        modalId="boardCreateModal"
        open={boardCreateOpen}
        onClose={() => closeModalById('boardCreateModal')}
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>게시판 생성</h3>
              <p className="meta" style={{ marginTop: '6px' }}>ID, 이름, 설명, 허용 등급을 입력합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="boardCreateModal"
              onClick={() => closeModalById('boardCreateModal')}
            >
              닫기
            </button>
          </div>

          <form id="createBoardModalForm" className="stack" style={{ marginTop: '12px' }} onSubmit={saveCreateBoard}>
            <label>
              게시판 ID
              <input
                id="createBoardId"
                type="text"
                placeholder="예: notices"
                required
                value={createBoardForm.id}
                onChange={(event) => {
                  const sanitized = sanitizeRoleKey(event.target.value);
                  setCreateBoardForm((prev) => ({ ...prev, id: sanitized }));
                }}
                disabled={!canManageBoards}
              />
            </label>
            <p className="meta" style={{ margin: '-2px 0 0' }}>영문/숫자/_만 입력할 수 있습니다.</p>
            <label>
              게시판 이름
              <input
                id="createBoardName"
                type="text"
                placeholder="예: 공지사항"
                required
                value={createBoardForm.name}
                onChange={(event) => setCreateBoardForm((prev) => ({ ...prev, name: event.target.value }))}
                disabled={!canManageBoards}
              />
            </label>
            <label>
              설명
              <input
                id="createBoardDescription"
                type="text"
                placeholder="간단 설명"
                value={createBoardForm.description}
                onChange={(event) => setCreateBoardForm((prev) => ({ ...prev, description: event.target.value }))}
                disabled={!canManageBoards}
              />
            </label>
            <div className="board-role-box">
              <p className="meta" style={{ margin: '0 0 6px' }}>이용 가능 등급</p>
              <div id="createBoardRoleList" className="row board-role-list">
                {getBoardRoleChoices(createBoardForm.allowedRoles).map((item) => (
                  <label
                    key={`create-board-role-${item.role}`}
                    className={`row board-role-option${item.checked ? ' is-selected' : ''}${!canManageBoards ? ' is-disabled' : ''}`}
                  >
                    <input
                      type="checkbox"
                      value={item.role}
                      checked={item.checked}
                      disabled={!canManageBoards}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCreateBoardForm((prev) => {
                          const selectedSet = new Set(normalizeRoles(prev.allowedRoles));
                          if (checked) selectedSet.add(item.role);
                          else selectedSet.delete(item.role);
                          return { ...prev, allowedRoles: [...selectedSet] };
                        });
                      }}
                    />
                    <span>{item.role}({item.labelKo}){item.extra ? ' *' : ''}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary" disabled={!canManageBoards}>생성</button>
            </div>
          </form>
      </AdminModal>

      <AdminModal
        modalId="roleEditModal"
        open={roleEditOpen}
        onClose={() => closeModalById('roleEditModal')}
        panelClassName="admin-modal-panel board-edit-modal-panel"
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>등급 수정</h3>
              <p className="meta" style={{ marginTop: '6px' }}>등급을 선택하고 정보/권한/배지를 수정합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="roleEditModal"
              onClick={() => closeModalById('roleEditModal')}
            >
              닫기
            </button>
          </div>

          <div className="grid grid-2 board-edit-layout" style={{ marginTop: '12px' }}>
            <div className="board-edit-list-wrap">
              <p className="meta" style={{ margin: '0 0 8px' }}>등급 목록</p>
              <div id="roleEditList" className="board-edit-list">
                {!editableRoles.length ? (
                  <p className="muted" style={{ margin: 0 }}>수정 가능한 커스텀 등급이 없습니다.</p>
                ) : editableRoles.map((roleDoc) => {
                  const activeClass = roleDoc.role === activeEditRoleKey ? ' active' : '';
                  return (
                    <button
                      key={roleDoc.role}
                      type="button"
                      className={`board-edit-item${activeClass}`}
                      data-role-key={roleDoc.role}
                      onClick={() => {
                        setActiveEditRoleKey(roleDoc.role);
                        setEditRoleForm({
                          role: roleDoc.role,
                          labelKo: roleDoc.labelKo || roleDoc.role,
                          level: roleLevelOf(roleDoc.role) || '',
                          badgeBgColor: normalizeBadgeColor(roleDoc.badgeBgColor, '#ffffff'),
                          badgeTextColor: normalizeBadgeColor(roleDoc.badgeTextColor, '#334155'),
                          adminDeleteLocked: !!roleDoc.adminDeleteLocked,
                          flags: buildRoleFlagsFromDoc(roleDoc)
                        });
                      }}
                    >
                      <div><strong>{roleDoc.labelKo || roleDoc.role}</strong></div>
                      <div className="meta" style={{ marginTop: '4px' }}>{roleDoc.role}</div>
                    </button>
                  );
                })}
              </div>
            </div>

            <form id="editRoleForm" className="stack" onSubmit={saveEditRole}>
              <label>
                Role Key
                <input id="editRoleKey" type="text" readOnly value={editRoleForm.role} />
              </label>
              <label>
                한글 표시명
                <input
                  id="editRoleLabelKo"
                  type="text"
                  required
                  value={editRoleForm.labelKo}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, labelKo: event.target.value }))}
                  disabled={!canManageRoleDefinitions || !editRoleForm.role}
                />
              </label>
              <label>
                Level
                <input
                  id="editRoleLevel"
                  type="number"
                  min="1"
                  max="100"
                  required
                  value={editRoleForm.level}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, level: event.target.value }))}
                  disabled={!canManageRoleDefinitions || !editRoleForm.role}
                />
              </label>
              <RoleColorField
                id="editRoleBadgeBgColor"
                label="배지 배경색"
                value={editRoleForm.badgeBgColor}
                disabled={!canManageRoleDefinitions || !editRoleForm.role}
                onChange={(nextColor) => setEditRoleForm((prev) => ({ ...prev, badgeBgColor: nextColor }))}
              />
              <RoleColorField
                id="editRoleBadgeTextColor"
                label="배지 글자색"
                value={editRoleForm.badgeTextColor}
                disabled={!canManageRoleDefinitions || !editRoleForm.role}
                onChange={(nextColor) => setEditRoleForm((prev) => ({ ...prev, badgeTextColor: nextColor }))}
              />
              <div className="role-badge-preview-wrap">
                <p className="meta" style={{ margin: '0 0 6px' }}>배지 미리보기</p>
                <span
                  id="editRoleBadgePreview"
                  className="role-badge"
                  style={{
                    background: editRoleBadgePalette.bgColor,
                    color: editRoleBadgePalette.textColor,
                    borderColor: editRoleBadgePalette.borderColor
                  }}
                >
                  {normalizeText(editRoleForm.labelKo) || sanitizeRoleKey(editRoleForm.role) || 'Role'}
                </span>
              </div>
              <label className="row role-lock-toggle">
                <input
                  id="editRoleAdminDeleteLocked"
                  type="checkbox"
                  checked={!!editRoleForm.adminDeleteLocked}
                  onChange={(event) => setEditRoleForm((prev) => ({ ...prev, adminDeleteLocked: event.target.checked }))}
                  disabled={!canManageRoleDefinitions || !isSuperAdminUser || !editRoleForm.role}
                />
                <span>Admin 삭제 불가</span>
              </label>
              <div>
                <p className="meta" style={{ margin: '0 0 6px' }}>권한</p>
                <div id="editRolePermissionFlags" className="grid grid-3">
                  {roleFlagDefs.map((flag) => (
                    <label key={`edit-role-flag-${flag.key}`} className="row role-flag-item">
                      <input
                        type="checkbox"
                        checked={!!editRoleForm.flags[flag.key]}
                        disabled={!canManageRoleDefinitions || !editRoleForm.role}
                        onChange={(event) => {
                          const checked = event.target.checked;
                          setEditRoleForm((prev) => ({
                            ...prev,
                            flags: {
                              ...prev.flags,
                              [flag.key]: checked
                            }
                          }));
                        }}
                      />
                      <span>{flag.label}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="row" style={{ justifyContent: 'flex-end' }}>
                <button id="deleteRoleBtn" type="button" className="btn-danger" disabled={editRoleDeleteDisabled} onClick={() => removeRole().catch((err) => pushMessage(err?.message || 'Role 삭제 실패', 'error'))}>
                  삭제
                </button>
                <button type="submit" className="btn-primary" disabled={!canManageRoleDefinitions || !editRoleForm.role}>저장</button>
              </div>
            </form>
          </div>
      </AdminModal>

      <AdminModal
        modalId="roleCreateModal"
        open={roleCreateOpen}
        onClose={() => closeModalById('roleCreateModal')}
      >
          <div className="row space-between mobile-col">
            <div>
              <h3>등급 생성</h3>
              <p className="meta" style={{ marginTop: '6px' }}>새 등급의 정보/권한/배지를 입력합니다.</p>
            </div>
            <button
              type="button"
              className="panel-close-btn"
              data-modal-close="roleCreateModal"
              onClick={() => closeModalById('roleCreateModal')}
            >
              닫기
            </button>
          </div>

          <form id="createRoleForm" className="stack" style={{ marginTop: '12px' }} onSubmit={saveCreateRole}>
            <label>
              Role Key
              <input
                id="roleKey"
                type="text"
                placeholder="예: Staff"
                required
                value={createRoleForm.role}
                onChange={(event) => {
                  const sanitized = sanitizeRoleKey(event.target.value);
                  setCreateRoleForm((prev) => ({ ...prev, role: sanitized }));
                }}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <label>
              한글 표시명
              <input
                id="roleLabelKo"
                type="text"
                placeholder="예: 스태프"
                required
                value={createRoleForm.labelKo}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, labelKo: event.target.value }))}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <label>
              Level
              <input
                id="roleLevel"
                type="number"
                min="1"
                max="100"
                required
                value={createRoleForm.level}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, level: event.target.value }))}
                disabled={!canManageRoleDefinitions}
              />
            </label>
            <RoleColorField
              id="roleBadgeBgColor"
              label="배지 배경색"
              value={createRoleForm.badgeBgColor}
              disabled={!canManageRoleDefinitions}
              onChange={(nextColor) => setCreateRoleForm((prev) => ({ ...prev, badgeBgColor: nextColor }))}
            />
            <RoleColorField
              id="roleBadgeTextColor"
              label="배지 글자색"
              value={createRoleForm.badgeTextColor}
              disabled={!canManageRoleDefinitions}
              onChange={(nextColor) => setCreateRoleForm((prev) => ({ ...prev, badgeTextColor: nextColor }))}
            />
            <div className="role-badge-preview-wrap">
              <p className="meta" style={{ margin: '0 0 6px' }}>배지 미리보기</p>
              <span
                id="roleBadgePreview"
                className="role-badge"
                style={{
                  background: createRoleBadgePalette.bgColor,
                  color: createRoleBadgePalette.textColor,
                  borderColor: createRoleBadgePalette.borderColor
                }}
              >
                {normalizeText(createRoleForm.labelKo) || sanitizeRoleKey(createRoleForm.role) || 'Newbie'}
              </span>
            </div>
            <label className="row role-lock-toggle">
              <input
                id="createRoleAdminDeleteLocked"
                type="checkbox"
                checked={!!createRoleForm.adminDeleteLocked}
                onChange={(event) => setCreateRoleForm((prev) => ({ ...prev, adminDeleteLocked: event.target.checked }))}
                disabled={!canManageRoleDefinitions || !isSuperAdminUser}
              />
              <span>Admin 삭제 불가</span>
            </label>
            <div>
              <p className="meta" style={{ margin: '0 0 6px' }}>권한</p>
              <div id="rolePermissionFlags" className="grid grid-3">
                {roleFlagDefs.map((flag) => (
                  <label key={`create-role-flag-${flag.key}`} className="row role-flag-item">
                    <input
                      type="checkbox"
                      checked={!!createRoleForm.flags[flag.key]}
                      disabled={!canManageRoleDefinitions}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setCreateRoleForm((prev) => ({
                          ...prev,
                          flags: {
                            ...prev.flags,
                            [flag.key]: checked
                          }
                        }));
                      }}
                    />
                    <span>{flag.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="row" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="btn-primary" disabled={!canManageRoleDefinitions}>생성</button>
            </div>
          </form>
      </AdminModal>

      <AnimatePresence>
        {appliedPopup.open ? (
          <motion.div
            id="appliedPopup"
            className={`applied-popup show ${appliedPopup.tone === 'notice' ? 'is-notice' : appliedPopup.tone === 'error' ? 'is-error' : 'is-ok'}`}
            role="status"
            aria-live="polite"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
          >
            {appliedPopup.text}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
