// AppPage composer input state.
// - Holds the controlled state for post title, cover-for rows, mention menu
//   basics, and the inline day-picker modal.
// - Validation and submit side-effects intentionally live in sibling hooks.
import { useCallback, useRef, useState } from 'react';

export function useAppComposerState({
  COMPOSER_MENTION_MENU_INITIAL,
  COVER_FOR_CUSTOM_VENUE_VALUE,
  COVER_FOR_DEFAULT_END_TIME,
  COVER_FOR_DEFAULT_START_TIME,
  COVER_FOR_DEFAULT_VENUE,
  DEFAULT_COVER_FOR_VENUE_OPTIONS,
  composerVenueInputRefs,
  normalizeCoverForTimeValues,
  normalizeCoverForVenue,
  normalizeCoverForVenueValues,
  normalizeCoverVenueOptions,
  normalizeDateKeyInput,
  normalizeText,
  normalizeTimeInput,
  sanitizeCoverForVenueInput,
  suggestEndTime,
  timeValueToMinutes,
  toDateKey,
  todayDate,
  isValidTimeRange,
  logCoverVenueDebug
}) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMessage, setComposerMessage] = useState({ type: '', text: '' });
  const [postTitle, setPostTitle] = useState('');
  const [composerCoverDateKeys, setComposerCoverDateKeys] = useState(() => {
    const todayKey = toDateKey(new Date());
    return todayKey ? [todayKey] : [];
  });
  const [composerCoverStartTimeValues, setComposerCoverStartTimeValues] = useState([COVER_FOR_DEFAULT_START_TIME]);
  const [composerCoverEndTimeValues, setComposerCoverEndTimeValues] = useState([COVER_FOR_DEFAULT_END_TIME]);
  const [composerCoverVenueValues, setComposerCoverVenueValues] = useState([COVER_FOR_DEFAULT_VENUE]);
  const [composerCoverVenueCustomModes, setComposerCoverVenueCustomModes] = useState([false]);
  const [, setComposerVenueInputFocusIndex] = useState(-1);
  const [composerMentionMenu, setComposerMentionMenu] = useState(COMPOSER_MENTION_MENU_INITIAL);
  const [composerMentionCandidates, setComposerMentionCandidates] = useState([]);
  const [composerMentionActiveIndex, setComposerMentionActiveIndex] = useState(0);
  const [venueOptions, setVenueOptions] = useState(DEFAULT_COVER_FOR_VENUE_OPTIONS);
  const [submittingPost, setSubmittingPost] = useState(false);
  const [composerDatePickerOpen, setComposerDatePickerOpen] = useState(false);
  const [composerDatePickerTargetIndex, setComposerDatePickerTargetIndex] = useState(-1);
  const [composerDatePickerCursor, setComposerDatePickerCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const composerDatePickerOpenedAtRef = useRef(0);
  const coverVenueOptions = normalizeCoverVenueOptions(venueOptions);
  const coverVenueDefault = coverVenueOptions.includes(COVER_FOR_DEFAULT_VENUE)
    ? COVER_FOR_DEFAULT_VENUE
    : (coverVenueOptions[0] || COVER_FOR_DEFAULT_VENUE);

  const addComposerCoverDate = useCallback(() => {
    setComposerCoverDateKeys((prevDates) => {
      const normalizedDates = prevDates
        .map((value) => normalizeDateKeyInput(value))
        .filter(Boolean);
      if (normalizedDates.length >= 6) return normalizedDates;

      const fallbackDate = normalizeDateKeyInput(toDateKey(todayDate));
      const lastDate = normalizedDates.length
        ? normalizeDateKeyInput(normalizedDates[normalizedDates.length - 1])
        : fallbackDate;
      const nextBaseDate = lastDate ? new Date(lastDate) : todayDate;
      const nextDate = new Date(nextBaseDate.getFullYear(), nextBaseDate.getMonth(), nextBaseDate.getDate() + 1);
      const nextDateKey = normalizeDateKeyInput(toDateKey(nextDate)) || fallbackDate;

      setComposerCoverStartTimeValues((prevStartTimes) => {
        const normalizedStartTimes = normalizeCoverForTimeValues(prevStartTimes, normalizedDates.length, COVER_FOR_DEFAULT_START_TIME);
        return [...normalizedStartTimes, COVER_FOR_DEFAULT_START_TIME];
      });
      setComposerCoverEndTimeValues((prevEndTimes) => {
        const normalizedEndTimes = normalizeCoverForTimeValues(prevEndTimes, normalizedDates.length, COVER_FOR_DEFAULT_END_TIME);
        return [...normalizedEndTimes, COVER_FOR_DEFAULT_END_TIME];
      });
      setComposerCoverVenueValues((prevVenues) => {
        const normalizedVenues = normalizeCoverForVenueValues(prevVenues, normalizedDates.length, coverVenueDefault, { allowEmpty: true });
        return [...normalizedVenues, coverVenueDefault];
      });
      setComposerCoverVenueCustomModes((prevModes) => {
        const source = Array.isArray(prevModes) ? prevModes : [];
        const normalizedModes = [];
        for (let idx = 0; idx < normalizedDates.length; idx += 1) normalizedModes.push(Boolean(source[idx]));
        return [...normalizedModes, false];
      });
      setComposerVenueInputFocusIndex(-1);

      return [...normalizedDates, nextDateKey];
    });
  }, [
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    coverVenueDefault,
    normalizeCoverForTimeValues,
    normalizeCoverForVenueValues,
    normalizeDateKeyInput,
    toDateKey,
    todayDate
  ]);

  const removeComposerCoverDate = useCallback((index) => {
    setComposerCoverDateKeys((prevDates) => {
      if (prevDates.length <= 1 || index < 0 || index >= prevDates.length) return prevDates;
      const nextDates = prevDates.filter((_, idx) => idx !== index);
      setComposerCoverStartTimeValues((prevStartTimes) => {
        const normalizedStartTimes = normalizeCoverForTimeValues(prevStartTimes, prevDates.length, COVER_FOR_DEFAULT_START_TIME);
        return normalizedStartTimes.filter((_, idx) => idx !== index);
      });
      setComposerCoverEndTimeValues((prevEndTimes) => {
        const normalizedEndTimes = normalizeCoverForTimeValues(prevEndTimes, prevDates.length, COVER_FOR_DEFAULT_END_TIME);
        return normalizedEndTimes.filter((_, idx) => idx !== index);
      });
      setComposerCoverVenueValues((prevVenues) => {
        const normalizedVenues = normalizeCoverForVenueValues(prevVenues, prevDates.length, coverVenueDefault, { allowEmpty: true });
        return normalizedVenues.filter((_, idx) => idx !== index);
      });
      setComposerCoverVenueCustomModes((prevModes) => {
        const source = Array.isArray(prevModes) ? prevModes : [];
        const normalizedModes = [];
        for (let idx = 0; idx < prevDates.length; idx += 1) normalizedModes.push(Boolean(source[idx]));
        return normalizedModes.filter((_, idx) => idx !== index);
      });
      return nextDates;
    });
  }, [
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    coverVenueDefault,
    normalizeCoverForTimeValues,
    normalizeCoverForVenueValues
  ]);

  const updateComposerCoverDate = useCallback((index, nextValue) => {
    setComposerCoverDateKeys((prevDates) => {
      if (index < 0 || index >= prevDates.length) return prevDates;
      const next = [...prevDates];
      const normalized = normalizeDateKeyInput(nextValue);
      next[index] = normalized || next[index] || normalizeDateKeyInput(toDateKey(todayDate));
      return next;
    });
  }, [normalizeDateKeyInput, toDateKey, todayDate]);

  const updateComposerCoverStartTime = useCallback((index, nextValue) => {
    const normalizedStart = normalizeTimeInput(nextValue) || COVER_FOR_DEFAULT_START_TIME;
    setComposerCoverStartTimeValues((prevStartTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevStartTimes, maxSize, COVER_FOR_DEFAULT_START_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      next[index] = normalizedStart;
      return next;
    });

    setComposerCoverEndTimeValues((prevEndTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevEndTimes, maxSize, COVER_FOR_DEFAULT_END_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      const currentEnd = normalizeTimeInput(next[index]) || COVER_FOR_DEFAULT_END_TIME;
      next[index] = isValidTimeRange(normalizedStart, currentEnd)
        ? currentEnd
        : suggestEndTime(normalizedStart);
      return next;
    });
  }, [
    composerCoverDateKeys.length,
    COVER_FOR_DEFAULT_END_TIME,
    COVER_FOR_DEFAULT_START_TIME,
    isValidTimeRange,
    normalizeCoverForTimeValues,
    normalizeTimeInput,
    suggestEndTime
  ]);

  const updateComposerCoverEndTime = useCallback((index, nextValue) => {
    setComposerCoverEndTimeValues((prevEndTimes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForTimeValues(prevEndTimes, maxSize, COVER_FOR_DEFAULT_END_TIME);
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      next[index] = normalizeTimeInput(nextValue) || COVER_FOR_DEFAULT_END_TIME;
      return next;
    });
  }, [composerCoverDateKeys.length, COVER_FOR_DEFAULT_END_TIME, normalizeCoverForTimeValues, normalizeTimeInput]);

  const updateComposerCoverVenue = useCallback((index, nextValue, options = {}) => {
    const keepRaw = !!options.keepRaw;
    setComposerCoverVenueValues((prevVenues) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const normalized = normalizeCoverForVenueValues(prevVenues, maxSize, coverVenueDefault, { allowEmpty: true });
      if (index < 0 || index >= normalized.length) return normalized;
      const next = [...normalized];
      const sanitizedInput = sanitizeCoverForVenueInput(nextValue);
      next[index] = keepRaw ? sanitizedInput : normalizeCoverForVenue(sanitizedInput);
      return next;
    });
  }, [composerCoverDateKeys.length, coverVenueDefault, normalizeCoverForVenue, normalizeCoverForVenueValues, sanitizeCoverForVenueInput]);

  const setComposerCoverVenueCustomMode = useCallback((index, enabled) => {
    setComposerCoverVenueCustomModes((prevModes) => {
      const maxSize = Math.max(composerCoverDateKeys.length, 1);
      const source = Array.isArray(prevModes) ? prevModes : [];
      const normalizedModes = [];
      for (let idx = 0; idx < maxSize; idx += 1) normalizedModes.push(Boolean(source[idx]));
      if (index < 0 || index >= normalizedModes.length) return normalizedModes;
      const next = [...normalizedModes];
      next[index] = Boolean(enabled);
      return next;
    });
  }, [composerCoverDateKeys.length]);

  const updateComposerCoverVenueSelect = useCallback((index, nextValue) => {
    const selectedValue = normalizeText(nextValue);
    logCoverVenueDebug('select-change', {
      index,
      selectedValue,
      currentValue: sanitizeCoverForVenueInput(composerCoverVenueValues[index])
    });

    if (selectedValue === COVER_FOR_CUSTOM_VENUE_VALUE) {
      setComposerCoverVenueCustomMode(index, true);
      const currentVenueRaw = sanitizeCoverForVenueInput(composerCoverVenueValues[index]);
      const currentVenue = normalizeCoverForVenue(currentVenueRaw);
      const keepCustom = currentVenue && !coverVenueOptions.includes(currentVenue) ? currentVenueRaw : '';
      updateComposerCoverVenue(index, keepCustom, { keepRaw: true });

      window.setTimeout(() => {
        const inputEl = composerVenueInputRefs.current[index];
        if (!inputEl) return;
        inputEl.focus();
        setComposerVenueInputFocusIndex(index);
      }, 40);
      return;
    }

    setComposerCoverVenueCustomMode(index, false);
    updateComposerCoverVenue(index, selectedValue);
  }, [
    COVER_FOR_CUSTOM_VENUE_VALUE,
    composerCoverVenueValues,
    composerVenueInputRefs,
    coverVenueOptions,
    normalizeCoverForVenue,
    normalizeText,
    sanitizeCoverForVenueInput,
    setComposerCoverVenueCustomMode,
    updateComposerCoverVenue,
    logCoverVenueDebug
  ]);

  const openComposerDatePicker = useCallback((index) => {
    const normalizedIndex = Number(index);
    if (!Number.isFinite(normalizedIndex) || normalizedIndex < 0) return;
    const selectedKey = normalizeDateKeyInput(composerCoverDateKeys[normalizedIndex]) || toDateKey(todayDate);
    const selectedDate = selectedKey ? new Date(selectedKey) : todayDate;
    setComposerDatePickerTargetIndex(normalizedIndex);
    setComposerDatePickerCursor(new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1));
    composerDatePickerOpenedAtRef.current = Date.now();
    setComposerDatePickerOpen(true);
  }, [composerCoverDateKeys, normalizeDateKeyInput, toDateKey, todayDate]);

  const closeComposerDatePicker = useCallback((options = {}) => {
    const source = normalizeText(options?.source);
    if (source === 'backdrop') {
      const openedAt = Number(composerDatePickerOpenedAtRef.current) || 0;
      if (Date.now() - openedAt < 320) return;
    }
    setComposerDatePickerOpen(false);
    setComposerDatePickerTargetIndex(-1);
    composerDatePickerOpenedAtRef.current = 0;
  }, [normalizeText]);

  return {
    composerOpen,
    setComposerOpen,
    composerMessage,
    setComposerMessage,
    postTitle,
    setPostTitle,
    composerCoverDateKeys,
    setComposerCoverDateKeys,
    composerCoverStartTimeValues,
    setComposerCoverStartTimeValues,
    composerCoverEndTimeValues,
    setComposerCoverEndTimeValues,
    composerCoverVenueValues,
    setComposerCoverVenueValues,
    composerCoverVenueCustomModes,
    setComposerCoverVenueCustomModes,
    setComposerVenueInputFocusIndex,
    composerMentionMenu,
    setComposerMentionMenu,
    composerMentionCandidates,
    setComposerMentionCandidates,
    composerMentionActiveIndex,
    setComposerMentionActiveIndex,
    venueOptions,
    setVenueOptions,
    coverVenueOptions,
    coverVenueDefault,
    submittingPost,
    setSubmittingPost,
    composerDatePickerOpen,
    setComposerDatePickerOpen,
    composerDatePickerTargetIndex,
    setComposerDatePickerTargetIndex,
    composerDatePickerCursor,
    setComposerDatePickerCursor,
    addComposerCoverDate,
    removeComposerCoverDate,
    updateComposerCoverDate,
    updateComposerCoverStartTime,
    updateComposerCoverEndTime,
    updateComposerCoverVenue,
    setComposerCoverVenueCustomMode,
    updateComposerCoverVenueSelect,
    openComposerDatePicker,
    closeComposerDatePicker
  };
}
