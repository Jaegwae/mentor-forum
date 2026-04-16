// Calendar projection hook for AppPage.
// - Normalizes visible posts into date-keyed event buckets for the shared
//   calendar UI.
// - Handles both cover-for request posts and work-schedule rows so the view can
//   render one consistent calendar surface.
import { useEffect, useMemo, useState } from 'react';

export function useAppCalendar({
  currentBoard,
  currentUserProfile,
  selectedBoardId,
  visiblePosts,
  todayDate,
  normalizeText,
  isCalendarBoardId,
  isDeletedPost,
  buildPastelTone,
  toMillis,
  toDateKey,
  fromDateKey,
  normalizeDateKeyInput,
  normalizeWorkScheduleRows,
  buildWorkScheduleSummaryLines,
  workScheduleRowContainsPersonName,
  normalizeWorkScheduleMemberText,
  postCoverForDateEntries,
  normalizeCoverForStatus,
  normalizeTimeInput,
  normalizeCoverForVenue,
  COVER_FOR_BOARD_ID,
  WORK_SCHEDULE_BOARD_ID,
  COVER_FOR_STATUS,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_END_TIME,
  COVER_FOR_DEFAULT_VENUE,
  COVER_CALENDAR_PREVIEW_LIMIT
}) {
  const [coverCalendarCursor, setCoverCalendarCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [coverCalendarSelectedDate, setCoverCalendarSelectedDate] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  });
  const [coverCalendarModalOpen, setCoverCalendarModalOpen] = useState(false);
  const [coverCalendarModalDateKey, setCoverCalendarModalDateKey] = useState('');

  const calendarBoardId = normalizeText(selectedBoardId) || normalizeText(currentBoard?.id);
  const showCoverCalendar = isCalendarBoardId(calendarBoardId);

  const coverCalendarMonthLabel = useMemo(() => {
    const firstDay = new Date(coverCalendarCursor.getFullYear(), coverCalendarCursor.getMonth(), 1);
    return firstDay.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long' });
  }, [coverCalendarCursor]);

  useEffect(() => {
    if (showCoverCalendar) return;
    setCoverCalendarModalOpen(false);
    setCoverCalendarModalDateKey('');
  }, [showCoverCalendar]);

  const coverCalendarEventsByDate = useMemo(() => {
    const map = new Map();
    if (!showCoverCalendar) return map;
    const currentUserRealName = normalizeText(currentUserProfile?.realName);

    visiblePosts
      .filter((post) => !isDeletedPost(post) && isCalendarBoardId(post.boardId))
      .forEach((post) => {
        const authorName = normalizeText(post.authorName || post.authorUid) || '익명';
        const tone = buildPastelTone(post.id);
        const boardId = normalizeText(post.boardId);

        if (boardId === WORK_SCHEDULE_BOARD_ID) {
          const rows = normalizeWorkScheduleRows(post?.workScheduleRows);
          rows.forEach((row, rowIndex) => {
            const dateKey = normalizeDateKeyInput(row?.dateKey);
            if (!dateKey) return;
            const summaryLines = buildWorkScheduleSummaryLines(row);
            const eventId = [String(post.id), String(dateKey), 'work_schedule', String(rowIndex)].join('|');
            if (!map.has(dateKey)) map.set(dateKey, []);
            map.get(dateKey).push({
              id: eventId,
              eventId,
              kind: 'work_schedule',
              postId: post.id,
              boardId: post.boardId,
              authorName,
              title: normalizeText(post.title) || '(제목 없음)',
              fullTime: normalizeWorkScheduleMemberText(row?.fullTime),
              part1: normalizeWorkScheduleMemberText(row?.part1),
              part2: normalizeWorkScheduleMemberText(row?.part2),
              part3: normalizeWorkScheduleMemberText(row?.part3),
              education: normalizeWorkScheduleMemberText(row?.education),
              summaryLines,
              label: currentUserRealName && workScheduleRowContainsPersonName(row, currentUserRealName)
                ? '[근무 하는 날]'
                : '',
              tone,
              createdAtMs: toMillis(post.createdAt)
            });
          });
          return;
        }

        const entries = postCoverForDateEntries(post);
        entries.forEach(({ dateKey, status, startTimeValue, endTimeValue, venue }, entryIndex) => {
          if (!dateKey) return;
          if (normalizeCoverForStatus(status) !== COVER_FOR_STATUS.SEEKING) return;
          const safeStartTime = normalizeTimeInput(startTimeValue) || COVER_FOR_DEFAULT_START_TIME;
          const safeEndTime = normalizeTimeInput(endTimeValue) || COVER_FOR_DEFAULT_END_TIME;
          const safeVenue = normalizeCoverForVenue(venue) || normalizeCoverForVenue(post.coverForVenue) || COVER_FOR_DEFAULT_VENUE;
          const eventId = [
            String(post.id),
            String(dateKey),
            String(safeStartTime),
            String(safeEndTime),
            String(safeVenue),
            String(entryIndex)
          ].join('|');
          if (!map.has(dateKey)) map.set(dateKey, []);
          map.get(dateKey).push({
            id: eventId,
            eventId,
            kind: 'cover_for',
            postId: post.id,
            boardId: post.boardId,
            authorName,
            title: normalizeText(post.title) || '(제목 없음)',
            startTimeValue: safeStartTime,
            endTimeValue: safeEndTime,
            venue: safeVenue,
            status,
            tone,
            createdAtMs: toMillis(post.createdAt)
          });
        });
      });

    map.forEach((items, key) => {
      items.sort((a, b) => {
        const byDate = b.createdAtMs - a.createdAtMs;
        if (byDate !== 0) return byDate;
        return String(a.postId).localeCompare(String(b.postId), 'ko');
      });
      map.set(key, items);
    });

    return map;
  }, [
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_DEFAULT_VENUE,
    COVER_FOR_STATUS.SEEKING,
    buildPastelTone,
    buildWorkScheduleSummaryLines,
    currentUserProfile?.realName,
    isCalendarBoardId,
    isDeletedPost,
    normalizeCoverForStatus,
    normalizeCoverForVenue,
    normalizeDateKeyInput,
    normalizeText,
    normalizeTimeInput,
    normalizeWorkScheduleMemberText,
    normalizeWorkScheduleRows,
    postCoverForDateEntries,
    showCoverCalendar,
    toMillis,
    visiblePosts,
    workScheduleRowContainsPersonName,
    WORK_SCHEDULE_BOARD_ID
  ]);

  const coverCalendarModalItems = useMemo(() => {
    if (!coverCalendarModalDateKey) return [];
    return coverCalendarEventsByDate.get(coverCalendarModalDateKey) || [];
  }, [coverCalendarEventsByDate, coverCalendarModalDateKey]);

  const coverCalendarModalDateText = useMemo(() => {
    const date = fromDateKey(coverCalendarModalDateKey);
    if (!date) return '-';
    return date.toLocaleDateString('ko-KR', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }, [coverCalendarModalDateKey, fromDateKey]);

  const coverCalendarCells = useMemo(() => {
    const year = coverCalendarCursor.getFullYear();
    const month = coverCalendarCursor.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cellCount = Math.ceil((firstWeekday + daysInMonth) / 7) * 7;

    const todayKey = toDateKey(todayDate);
    const selectedKey = toDateKey(coverCalendarSelectedDate);
    const cells = [];

    for (let idx = 0; idx < cellCount; idx += 1) {
      const cellDate = new Date(year, month, idx - firstWeekday + 1);
      const dateKey = toDateKey(cellDate);
      const inMonth = cellDate.getMonth() === month;

      const classes = ['cover-calendar-day'];
      if (!inMonth) classes.push('is-outside');
      if (cellDate.getDay() === 0) classes.push('is-sun');
      if (cellDate.getDay() === 6) classes.push('is-sat');
      // 오늘보다 이전 날짜는 "지난 일정/요청"으로 간주한다.
      // 실제 숨김 처리는 하지 않고, CSS에서 더 어두운 톤으로만 표현한다.
      if (cellDate.getTime() < todayDate.getTime()) classes.push('is-past');
      if (dateKey === todayKey) classes.push('is-today');
      if (dateKey === selectedKey) classes.push('is-selected');

      const dayEvents = coverCalendarEventsByDate.get(dateKey) || [];
      const eventCount = dayEvents.length;
      if (eventCount > 0) classes.push('has-events');
      const hasWorkScheduleEvents = dayEvents.some((event) => event.kind === 'work_schedule');
      const previewEvents = hasWorkScheduleEvents
        ? (() => {
          const mineEvent = dayEvents.find((event) => normalizeText(event?.label));
          if (!mineEvent) return [];
          return [{
            postId: mineEvent.postId,
            label: normalizeText(mineEvent.label),
            tone: mineEvent.tone
          }];
        })()
        : dayEvents.slice(0, COVER_CALENDAR_PREVIEW_LIMIT).map((event) => ({
          postId: event.postId,
          label: `[${event.startTimeValue || COVER_FOR_DEFAULT_START_TIME}~${event.endTimeValue || COVER_FOR_DEFAULT_END_TIME}] [${event.venue || COVER_FOR_DEFAULT_VENUE}]`,
          tone: event.tone
        }));

      cells.push({
        key: dateKey,
        classes: classes.join(' '),
        day: cellDate.getDate(),
        eventCount,
        previewEvents,
        hasMoreEvents: dayEvents.length > previewEvents.length,
        moreCount: Math.max(0, dayEvents.length - previewEvents.length)
      });
    }
    return cells;
  }, [
    COVER_CALENDAR_PREVIEW_LIMIT,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    COVER_FOR_DEFAULT_VENUE,
    coverCalendarCursor,
    coverCalendarEventsByDate,
    coverCalendarSelectedDate,
    normalizeText,
    toDateKey,
    todayDate
  ]);

  return {
    coverCalendarCursor,
    setCoverCalendarCursor,
    coverCalendarSelectedDate,
    setCoverCalendarSelectedDate,
    coverCalendarModalOpen,
    setCoverCalendarModalOpen,
    coverCalendarModalDateKey,
    setCoverCalendarModalDateKey,
    showCoverCalendar,
    coverCalendarMonthLabel,
    coverCalendarEventsByDate,
    coverCalendarModalItems,
    coverCalendarModalDateText,
    coverCalendarCells
  };
}
