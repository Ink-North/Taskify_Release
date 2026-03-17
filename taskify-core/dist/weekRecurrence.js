export function tasksInSameSeries(a, b) {
    if (a.seriesId && b.seriesId)
        return a.seriesId === b.seriesId;
    return (a.boardId === b.boardId &&
        a.title === b.title &&
        a.note === b.note &&
        !!a.recurrence &&
        !!b.recurrence &&
        JSON.stringify(a.recurrence) === JSON.stringify(b.recurrence));
}
export function ensureWeekRecurrencesForCurrentWeek(options) {
    const { tasks, sources, weekStart, newTaskPosition, dedupeRecurringInstances, isFrequentRecurrence, nextOccurrence, startOfWeek, recurringInstanceId, isoDatePart, taskDateKey, nextOrderForBoard, maybePublishTask, now = () => Date.now(), } = options;
    const sow = startOfWeek(new Date(), weekStart).getTime();
    const out = dedupeRecurringInstances(tasks);
    let changed = out !== tasks;
    const src = sources ?? out;
    for (const task of src) {
        if (!task.recurrence || !isFrequentRecurrence(task.recurrence))
            continue;
        const seriesId = task.seriesId || task.id;
        if (!task.seriesId) {
            const index = out.findIndex((candidate) => candidate.id === task.id);
            if (index >= 0 && out[index].seriesId !== seriesId) {
                out[index] = { ...out[index], seriesId };
                changed = true;
            }
        }
        const seriesSeed = task.seriesId ? task : { ...task, seriesId };
        let nextISO = nextOccurrence(task.dueISO, task.recurrence, !!task.dueTimeEnabled, task.dueTimeZone);
        while (nextISO) {
            const nextDate = new Date(nextISO);
            const nextStartOfWeek = startOfWeek(nextDate, weekStart).getTime();
            if (nextStartOfWeek > sow)
                break;
            if (nextStartOfWeek === sow) {
                const cloneId = recurringInstanceId(seriesId, nextISO, task.recurrence, task.dueTimeZone);
                const nextDateKey = isoDatePart(nextISO, task.dueTimeZone);
                const exists = out.some((candidate) => candidate.id === cloneId ||
                    (tasksInSameSeries(candidate, seriesSeed) && taskDateKey(candidate) === nextDateKey));
                if (!exists) {
                    const clone = {
                        ...task,
                        id: cloneId,
                        seriesId,
                        createdAt: now(),
                        completed: false,
                        completedAt: undefined,
                        completedBy: undefined,
                        dueISO: nextISO,
                        hiddenUntilISO: undefined,
                        order: nextOrderForBoard(task.boardId, out, newTaskPosition),
                        subtasks: task.subtasks?.map((subtask) => ({ ...subtask, completed: false })),
                        dueTimeEnabled: typeof task.dueTimeEnabled === "boolean" ? task.dueTimeEnabled : undefined,
                        reminders: Array.isArray(task.reminders) ? [...task.reminders] : undefined,
                    };
                    const publishTaskResult = maybePublishTask(clone);
                    if (publishTaskResult && typeof publishTaskResult.catch === "function") {
                        publishTaskResult.catch(() => { });
                    }
                    out.push(clone);
                    changed = true;
                }
            }
            nextISO = nextOccurrence(nextISO, task.recurrence, !!task.dueTimeEnabled, task.dueTimeZone);
        }
    }
    return changed ? out : tasks;
}
