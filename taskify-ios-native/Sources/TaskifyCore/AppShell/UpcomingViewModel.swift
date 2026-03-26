import Foundation

public enum UpcomingBoardGrouping: String, CaseIterable, Identifiable {
    case mixed
    case grouped

    public var id: String { rawValue }

    public var label: String {
        switch self {
        case .mixed: return "Across boards"
        case .grouped: return "Group by board"
        }
    }
}

public struct UpcomingBoardDefinition: Identifiable, Equatable {
    public let id: String
    public let name: String
    public let kind: String
    public let columns: [BoardColumn]

    public init(id: String, name: String, kind: String, columns: [BoardColumn] = []) {
        self.id = id
        self.name = name
        self.kind = kind
        self.columns = columns
    }
}

public struct UpcomingFilterOption: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let boardId: String
    public let columnId: String?

    public init(id: String, label: String, boardId: String, columnId: String? = nil) {
        self.id = id
        self.label = label
        self.boardId = boardId
        self.columnId = columnId
    }
}

public struct UpcomingFilterGroup: Identifiable, Equatable {
    public let id: String
    public let label: String
    public let boardId: String
    public let boardOption: UpcomingFilterOption
    public let listOptions: [UpcomingFilterOption]

    public init(
        id: String,
        label: String,
        boardId: String,
        boardOption: UpcomingFilterOption,
        listOptions: [UpcomingFilterOption]
    ) {
        self.id = id
        self.label = label
        self.boardId = boardId
        self.boardOption = boardOption
        self.listOptions = listOptions
    }
}

public struct UpcomingDateGroup: Identifiable, Equatable {
    public let dateKey: String
    public let label: String
    public let date: Date?
    public let tasks: [BoardTaskItem]

    public var id: String { dateKey }

    public init(dateKey: String, label: String, date: Date?, tasks: [BoardTaskItem]) {
        self.dateKey = dateKey
        self.label = label
        self.date = date
        self.tasks = tasks
    }
}

@MainActor
public final class UpcomingViewModel: ObservableObject {
    @Published public private(set) var groups: [UpcomingDateGroup] = []
    @Published public private(set) var filterGroups: [UpcomingFilterGroup] = []
    @Published public private(set) var dayTaskMap: [String: [BoardTaskItem]] = [:]
    @Published public private(set) var filteredTasks: [BoardTaskItem] = []
    @Published public private(set) var selectedFilterIDs: Set<String>? = nil
    @Published public private(set) var sortMode: TaskSortMode = .dueDate
    @Published public private(set) var sortAscending: Bool = true
    @Published public private(set) var boardGrouping: UpcomingBoardGrouping = .mixed
    @Published public private(set) var filterLabel: String = "All boards"
    @Published public private(set) var itemCount: Int = 0
    @Published public var searchText: String = "" {
        didSet { recompute() }
    }

    private var allTasks: [BoardTaskItem] = []
    private var boardDefinitions: [UpcomingBoardDefinition] = []
    private var boardDefinitionsById: [String: UpcomingBoardDefinition] = [:]

    public init() {}

    public func setTasks(_ tasks: [BoardTaskItem]) {
        allTasks = tasks
        recompute()
    }

    public func setBoards(_ boards: [UpcomingBoardDefinition]) {
        boardDefinitions = boards
        boardDefinitionsById = Dictionary(uniqueKeysWithValues: boards.map { ($0.id, $0) })
        rebuildFilterGroups()
        selectedFilterIDs = normalizedFilterSelection(selectedFilterIDs)
        recompute()
    }

    public func selectSortMode(_ mode: TaskSortMode) {
        if sortMode == mode {
            guard mode != .manual else { return }
            sortAscending.toggle()
        } else {
            sortMode = mode
            sortAscending = Self.defaultAscending(for: mode)
        }
        recompute()
    }

    public func setBoardGrouping(_ grouping: UpcomingBoardGrouping) {
        guard boardGrouping != grouping else { return }
        boardGrouping = grouping
        recompute()
    }

    public func setSelectedFilterIDs(_ ids: Set<String>?) {
        let normalized = normalizedFilterSelection(ids)
        guard normalized != selectedFilterIDs else { return }
        selectedFilterIDs = normalized
        recompute()
    }

    public func selectAllFilters() {
        setSelectedFilterIDs(nil)
    }

    public func clearAllFilters() {
        setSelectedFilterIDs([])
    }

    public func toggleFilterOption(_ optionId: String) {
        let allOptionIDs = Set(allFilterOptions.map(\.id))
        guard allOptionIDs.contains(optionId) else { return }

        let optionMap = Dictionary(uniqueKeysWithValues: allFilterOptions.map { ($0.id, $0) })
        guard let option = optionMap[optionId] else { return }

        var next = selectedFilterIDs ?? allOptionIDs
        let group = filterGroups.first(where: { $0.boardId == option.boardId })
        let boardOptionId = Self.boardOptionID(for: option.boardId)
        let listIDs = group?.listOptions.map(\.id) ?? []

        if option.columnId == nil {
            if next.contains(optionId) {
                next.remove(optionId)
                listIDs.forEach { next.remove($0) }
            } else {
                next.insert(optionId)
                listIDs.forEach { next.insert($0) }
            }
        } else {
            if next.contains(optionId) {
                next.remove(optionId)
            } else {
                next.insert(optionId)
                next.insert(boardOptionId)
            }
            let hasAnyList = listIDs.contains(where: next.contains)
            if !hasAnyList {
                next.remove(boardOptionId)
            }
        }

        setSelectedFilterIDs(next)
    }

    public func tasks(for dateKey: String) -> [BoardTaskItem] {
        dayTaskMap[dateKey] ?? []
    }

    public func resolvedDateKey(preferred: String) -> String? {
        guard !groups.isEmpty else { return nil }
        if groups.contains(where: { $0.dateKey == preferred }) {
            return preferred
        }
        if let next = groups.first(where: { $0.dateKey > preferred }) {
            return next.dateKey
        }
        return groups.last?.dateKey
    }

    public func dayNumbersWithItems(inMonth anchor: Date) -> Set<Int> {
        let calendar = Calendar.current
        let monthComponents = calendar.dateComponents([.year, .month], from: anchor)

        return Set(dayTaskMap.keys.compactMap { key in
            guard let parsed = Self.parseDateKey(key) else { return nil }
            guard parsed.year == monthComponents.year, parsed.month == monthComponents.month else { return nil }
            return parsed.day
        })
    }

    public func listName(for task: BoardTaskItem) -> String? {
        guard let boardId = task.boardId,
              let columnId = task.columnId,
              let board = boardDefinitionsById[boardId],
              board.kind == "lists"
        else {
            return nil
        }
        return board.columns.first(where: { $0.id == columnId })?.name
    }

    public func locationLabel(for task: BoardTaskItem) -> String {
        let boardName = task.boardName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedBoardName = (boardName?.isEmpty == false ? boardName : nil)
            ?? task.boardId.flatMap { boardDefinitionsById[$0]?.name }
            ?? "Board"

        if let listName = listName(for: task), !listName.isEmpty {
            return "\(resolvedBoardName) • \(listName)"
        }

        return resolvedBoardName
    }

    public static func defaultAscending(for mode: TaskSortMode) -> Bool {
        switch mode {
        case .manual, .dueDate, .alphabetical:
            return true
        case .priority, .createdAt:
            return false
        }
    }

    private var allFilterOptions: [UpcomingFilterOption] {
        filterGroups.flatMap { [$0.boardOption] + $0.listOptions }
    }

    private func rebuildFilterGroups() {
        filterGroups = boardDefinitions.compactMap { board in
            guard board.kind != "bible", board.kind != "compound" else { return nil }

            let boardOption = UpcomingFilterOption(
                id: Self.boardOptionID(for: board.id),
                label: board.name,
                boardId: board.id
            )
            let listOptions = board.kind == "lists"
                ? board.columns.map { column in
                    UpcomingFilterOption(
                        id: Self.columnOptionID(for: board.id, columnId: column.id),
                        label: column.name,
                        boardId: board.id,
                        columnId: column.id
                    )
                }
                : []

            return UpcomingFilterGroup(
                id: board.id,
                label: board.name,
                boardId: board.id,
                boardOption: boardOption,
                listOptions: listOptions
            )
        }
    }

    private func recompute() {
        let filtered = applyFilters(to: allTasks)
        filteredTasks = filtered
        itemCount = filtered.count

        var grouped: [String: [BoardTaskItem]] = [:]
        filtered.forEach { task in
            guard let dateKey = dueDateKey(for: task) else { return }
            grouped[dateKey, default: []].append(task)
        }

        for key in grouped.keys {
            grouped[key] = sortTasks(grouped[key] ?? [])
        }

        dayTaskMap = grouped
        groups = grouped.keys.sorted().map { key in
            UpcomingDateGroup(
                dateKey: key,
                label: Self.formatUpcomingDayLabel(key),
                date: Self.dateFromKey(key),
                tasks: grouped[key] ?? []
            )
        }
        filterLabel = buildFilterLabel()
    }

    private func applyFilters(to tasks: [BoardTaskItem]) -> [BoardTaskItem] {
        var filtered = tasks.filter { task in
            guard !task.completed else { return false }
            guard task.dueDateEnabled != false else { return false }
            return dueDateKey(for: task) != nil
        }

        if !allFilterOptions.isEmpty, let selectedFilterIDs {
            if selectedFilterIDs.isEmpty {
                filtered = []
            } else {
                let selection = selectedBoardAndListSelections(selectedFilterIDs)
                filtered = filtered.filter { task in
                    guard let boardId = task.boardId else { return false }
                    let board = boardDefinitionsById[boardId]
                    let listSet = selection.selectedLists[boardId]

                    if selection.selectedBoards.contains(boardId) {
                        if board?.kind == "lists" {
                            guard let columnId = task.columnId else { return false }
                            guard let listSet else { return true }
                            guard !listSet.isEmpty else { return false }
                            return listSet.contains(columnId)
                        }
                        return true
                    }

                    if let listSet, let columnId = task.columnId, listSet.contains(columnId) {
                        return true
                    }

                    return false
                }
            }
        }

        let searchTerm = searchText.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !searchTerm.isEmpty else { return filtered }

        return filtered.filter { task in
            let note = task.note?.lowercased() ?? ""
            return task.title.lowercased().contains(searchTerm) || note.contains(searchTerm)
        }
    }

    private func sortTasks(_ tasks: [BoardTaskItem]) -> [BoardTaskItem] {
        tasks.sorted { lhs, rhs in
            compare(lhs, rhs) < 0
        }
    }

    private func compare(_ lhs: BoardTaskItem, _ rhs: BoardTaskItem) -> Int {
        if boardGrouping == .grouped {
            let boardDiff = boardOrder(for: lhs) - boardOrder(for: rhs)
            if boardDiff != 0 { return boardDiff }
        }

        if sortMode == .manual {
            let orderDiff = (lhs.order ?? 0) - (rhs.order ?? 0)
            if orderDiff != 0 { return orderDiff }
            return compareFallback(lhs, rhs)
        }

        let primary: Int
        switch sortMode {
        case .manual:
            primary = 0
        case .dueDate:
            primary = compareDue(lhs, rhs, ascending: sortAscending)
        case .priority:
            primary = compareNumber(lhs.priority ?? 0, rhs.priority ?? 0, ascending: sortAscending)
        case .createdAt:
            primary = compareNumber(lhs.createdAt ?? 0, rhs.createdAt ?? 0, ascending: sortAscending)
        case .alphabetical:
            primary = compareText(lhs.title, rhs.title, ascending: sortAscending)
        }

        if primary != 0 { return primary }
        return compareFallback(lhs, rhs)
    }

    private func compareFallback(_ lhs: BoardTaskItem, _ rhs: BoardTaskItem) -> Int {
        let timeDiff = compareUpcomingTime(lhs, rhs, ascending: Self.defaultAscending(for: .dueDate))
        if timeDiff != 0 { return timeDiff }

        let boardDiff = boardOrder(for: lhs) - boardOrder(for: rhs)
        if boardDiff != 0 { return boardDiff }

        let orderDiff = (lhs.order ?? 0) - (rhs.order ?? 0)
        if orderDiff != 0 { return orderDiff }

        let titleDiff = compareText(lhs.title, rhs.title, ascending: Self.defaultAscending(for: .alphabetical))
        if titleDiff != 0 { return titleDiff }

        return lhs.id.localizedStandardCompare(rhs.id) == .orderedAscending ? -1 : 1
    }

    private func compareDue(_ lhs: BoardTaskItem, _ rhs: BoardTaskItem, ascending: Bool) -> Int {
        let lhsDateKey = dueDateKey(for: lhs)
        let rhsDateKey = dueDateKey(for: rhs)

        if lhsDateKey == nil, rhsDateKey == nil { return 0 }
        if lhsDateKey == nil { return 1 }
        if rhsDateKey == nil { return -1 }
        if lhsDateKey != rhsDateKey {
            return compareText(lhsDateKey ?? "", rhsDateKey ?? "", ascending: ascending)
        }

        let lhsHasTime = lhs.dueTimeEnabled == true
        let rhsHasTime = rhs.dueTimeEnabled == true
        if lhsHasTime != rhsHasTime {
            return lhsHasTime ? -1 : 1
        }

        if lhsHasTime, rhsHasTime {
            let lhsTimestamp = dueTimestamp(for: lhs)
            let rhsTimestamp = dueTimestamp(for: rhs)
            if lhsTimestamp == nil, rhsTimestamp == nil { return 0 }
            if lhsTimestamp == nil { return 1 }
            if rhsTimestamp == nil { return -1 }
            return compareNumber(lhsTimestamp ?? 0, rhsTimestamp ?? 0, ascending: ascending)
        }

        return 0
    }

    private func compareUpcomingTime(_ lhs: BoardTaskItem, _ rhs: BoardTaskItem, ascending: Bool) -> Int {
        let lhsTime = taskTimeValue(for: lhs)
        let rhsTime = taskTimeValue(for: rhs)

        if let lhsTime, let rhsTime, lhsTime != rhsTime {
            return compareNumber(lhsTime, rhsTime, ascending: ascending)
        }
        if lhsTime != nil, rhsTime == nil { return -1 }
        if lhsTime == nil, rhsTime != nil { return 1 }
        return 0
    }

    private func compareNumber(_ lhs: Int, _ rhs: Int, ascending: Bool) -> Int {
        let diff = lhs - rhs
        return ascending ? diff : -diff
    }

    private func compareText(_ lhs: String, _ rhs: String, ascending: Bool) -> Int {
        let result = lhs.localizedStandardCompare(rhs)
        switch result {
        case .orderedAscending:
            return ascending ? -1 : 1
        case .orderedDescending:
            return ascending ? 1 : -1
        case .orderedSame:
            return 0
        }
    }

    private func dueDateKey(for task: BoardTaskItem) -> String? {
        guard task.dueDateEnabled != false,
              let dueISO = task.dueISO,
              let date = Self.parseISO(dueISO)
        else {
            return nil
        }

        let components = Calendar.current.dateComponents([.year, .month, .day], from: date)
        guard let year = components.year, let month = components.month, let day = components.day else {
            return nil
        }

        return String(format: "%04d-%02d-%02d", year, month, day)
    }

    private func dueTimestamp(for task: BoardTaskItem) -> Int? {
        guard let dueISO = task.dueISO, let date = Self.parseISO(dueISO) else { return nil }
        return Int(date.timeIntervalSince1970)
    }

    private func taskTimeValue(for task: BoardTaskItem) -> Int? {
        guard task.dueTimeEnabled == true,
              let dueISO = task.dueISO,
              let date = Self.parseISO(dueISO)
        else {
            return nil
        }

        let components = Calendar.current.dateComponents([.hour, .minute], from: date)
        guard let hour = components.hour, let minute = components.minute else { return nil }
        return hour * 60 + minute
    }

    private func boardOrder(for task: BoardTaskItem) -> Int {
        guard let boardId = task.boardId,
              let index = boardDefinitions.firstIndex(where: { $0.id == boardId })
        else {
            return boardDefinitions.count + 1
        }
        return index
    }

    private func normalizedFilterSelection(_ ids: Set<String>?) -> Set<String>? {
        let allOptionIDs = Set(allFilterOptions.map(\.id))
        guard !allOptionIDs.isEmpty else { return nil }
        guard var next = ids else { return nil }

        next = next.intersection(allOptionIDs)

        let optionMap = Dictionary(uniqueKeysWithValues: allFilterOptions.map { ($0.id, $0) })
        for optionID in Array(next) {
            guard let option = optionMap[optionID], option.columnId != nil else { continue }
            next.insert(Self.boardOptionID(for: option.boardId))
        }

        for group in filterGroups {
            guard next.contains(group.boardOption.id), !group.listOptions.isEmpty else { continue }
            let hasAnyList = group.listOptions.contains(where: { next.contains($0.id) })
            if !hasAnyList {
                group.listOptions.forEach { next.insert($0.id) }
            }
        }

        if next.count == allOptionIDs.count {
            return nil
        }

        return next
    }

    private func selectedBoardAndListSelections(_ selectedIDs: Set<String>) -> (selectedBoards: Set<String>, selectedLists: [String: Set<String>]) {
        let optionMap = Dictionary(uniqueKeysWithValues: allFilterOptions.map { ($0.id, $0) })

        var boards = Set<String>()
        var lists: [String: Set<String>] = [:]

        for id in selectedIDs {
            guard let option = optionMap[id] else { continue }
            if let columnId = option.columnId {
                lists[option.boardId, default: []].insert(columnId)
            } else {
                boards.insert(option.boardId)
            }
        }

        return (boards, lists)
    }

    private func buildFilterLabel() -> String {
        guard !allFilterOptions.isEmpty else { return "No boards" }
        guard let selectedFilterIDs else { return "All boards" }
        if selectedFilterIDs.isEmpty { return "None" }
        if selectedFilterIDs.count == 1, let first = selectedFilterIDs.first {
            return allFilterOptions.first(where: { $0.id == first })?.label ?? "1 selected"
        }
        return "\(selectedFilterIDs.count) selected"
    }

    private static func parseISO(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    private static func parseDateKey(_ value: String) -> DateComponents? {
        let parts = value.split(separator: "-")
        guard parts.count == 3,
              let year = Int(parts[0]),
              let month = Int(parts[1]),
              let day = Int(parts[2])
        else {
            return nil
        }

        var components = DateComponents()
        components.year = year
        components.month = month
        components.day = day
        return components
    }

    private static func dateFromKey(_ value: String) -> Date? {
        guard let components = parseDateKey(value) else { return nil }
        return Calendar.current.date(from: components)
    }

    private static func formatUpcomingDayLabel(_ dateKey: String) -> String {
        guard let date = dateFromKey(dateKey) else { return dateKey }
        let weekday = weekdayFormatter.string(from: date)
        let monthDay = monthDayFormatter.string(from: date)
        return "\(weekday), \(monthDay)"
    }

    private static func boardOptionID(for boardId: String) -> String {
        "board:\(boardId)"
    }

    private static func columnOptionID(for boardId: String, columnId: String) -> String {
        "board:\(boardId):col:\(columnId)"
    }

    private static let weekdayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("EEEE")
        return formatter
    }()

    private static let monthDayFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMM d")
        return formatter
    }()
}
