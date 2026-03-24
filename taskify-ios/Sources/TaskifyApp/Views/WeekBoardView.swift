import SwiftUI
import SwiftData
import TaskifyCore

struct WeekBoardView: View {
    let board: TaskifyBoard
    @Environment(\.modelContext) private var modelContext
    @EnvironmentObject private var viewModel: AppViewModel
    @Query private var tasks: [TaskifyTask]

    private let calendar = Calendar.current
    private let daySymbols = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

    init(board: TaskifyBoard) {
        self.board = board
        let boardId = board.id
        _tasks = Query(filter: #Predicate<TaskifyTask> { task in
            task.boardId == boardId && task.deleted == false
        }, sort: [SortDescriptor(\TaskifyTask.createdAt, order: .reverse)])
    }

    var body: some View {
        VStack(spacing: 7) {
            topControls
            GeometryReader { geometry in
                weekScroller(pageWidth: geometry.size.width)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 4)
        .padding(.bottom, 84)
        .taskifyScreen()
    }

    private var topControls: some View {
        HStack(spacing: 8) {
            HStack(spacing: 0) {
                Button(action: {}) {
                    HStack(spacing: 8) {
                        Text("Week")
                            .font(.title3.weight(.medium))
                        Image(systemName: "chevron.down")
                            .font(.caption2.weight(.bold))
                            .foregroundStyle(TaskifyTheme.textSecondary)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
                    .padding(.horizontal, 18)
                }
                .buttonStyle(.plain)

                Divider().overlay(Color.white.opacity(0.08))

                Button(action: {}) {
                    Image(systemName: "square.and.arrow.up")
                        .font(.system(size: 15, weight: .medium))
                        .frame(width: 54, height: 40)
                }
                .buttonStyle(.plain)
            }
            .frame(height: 41)
            .pwaSurface(cornerRadius: 20.5, fill: TaskifyTheme.pwaControl, stroke: TaskifyTheme.pwaControlStroke)

            Spacer(minLength: 0)

            ForEach(["checkmark", "calendar", "arrow.up.arrow.down"], id: \.self) { icon in
                Button(action: {}) {
                    Image(systemName: icon)
                        .font(.system(size: 14, weight: .semibold))
                        .frame(width: 41, height: 41)
                }
                .buttonStyle(.plain)
                .pwaSurface(cornerRadius: 20.5, fill: TaskifyTheme.pwaControl, stroke: TaskifyTheme.pwaControlStroke)
            }
        }
    }

    private func weekScroller(pageWidth: CGFloat) -> some View {
        let dates = weekDates
        let todayIndex = dates.firstIndex(where: { calendar.isDateInToday($0) }) ?? 0

        return ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 10) {
                    ForEach(Array(dates.enumerated()), id: \.offset) { index, day in
                        dayColumn(
                            for: day,
                            symbol: daySymbols[calendar.component(.weekday, from: day) - 1],
                            isToday: calendar.isDateInToday(day),
                            width: pageWidth - 10
                        )
                        .id(index)
                    }
                }
                .scrollTargetLayout()
            }
            .onAppear {
                proxy.scrollTo(todayIndex, anchor: .center)
            }
            .scrollTargetBehavior(.viewAligned(limitBehavior: .always))
        }
    }

    private func dayColumn(for date: Date, symbol: String, isToday: Bool, width: CGFloat) -> some View {
        let dayTasks = tasksForDay(date)
        let openTasks = dayTasks.filter { !$0.completed }
        let completedTasks = dayTasks.filter { $0.completed }

        return ZStack(alignment: .bottom) {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 8) {
                    Text(symbol)
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(TaskifyTheme.textPrimary.opacity(0.96))
                    if isToday {
                        Text("Today")
                            .font(.caption2.weight(.bold))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 4)
                            .background(TaskifyTheme.accent.opacity(0.25))
                            .clipShape(Capsule())
                    }
                    Spacer()
                }
                .padding(.top, 2)

                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 10) {
                        ForEach(openTasks, id: \.id) { task in
                            TaskRowView(
                                task: task,
                                toggle: { try? viewModel.toggleTask(task, context: modelContext) },
                                open: { viewModel.openEditor(for: task) },
                                delete: { try? viewModel.deleteTask(task, context: modelContext) }
                            )
                        }

                        if !completedTasks.isEmpty {
                            VStack(alignment: .leading, spacing: 10) {
                                Text("Completed")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(TaskifyTheme.textSecondary)
                                ForEach(completedTasks, id: \.id) { task in
                                    TaskRowView(
                                        task: task,
                                        toggle: { try? viewModel.toggleTask(task, context: modelContext) },
                                        open: { viewModel.openEditor(for: task) },
                                        delete: { try? viewModel.deleteTask(task, context: modelContext) }
                                    )
                                }
                            }
                            .padding(.top, 4)
                        }

                        if dayTasks.isEmpty {
                            VStack(spacing: 10) {
                                Image(systemName: "sparkles")
                                    .font(.system(size: 20, weight: .medium))
                                    .foregroundStyle(TaskifyTheme.textTertiary)
                                Text("No tasks")
                                    .font(.subheadline.weight(.semibold))
                                    .foregroundStyle(TaskifyTheme.textSecondary)
                            }
                            .frame(maxWidth: .infinity, minHeight: 180)
                        }

                        Color.clear.frame(height: 84)
                    }
                    .padding(.bottom, 8)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 16)
            .frame(width: width, alignment: .topLeading)

            composerBar
                .padding(.horizontal, 12)
                .padding(.bottom, 10)
        }
        .frame(width: width)
        .frame(maxHeight: .infinity)
        .pwaSurface(cornerRadius: 32, fill: TaskifyTheme.pwaBoard, stroke: TaskifyTheme.pwaBoardStroke)
        .overlay(
            RoundedRectangle(cornerRadius: 32, style: .continuous)
                .inset(by: 10)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var composerBar: some View {
        HStack(spacing: 10) {
            Button(action: { viewModel.openComposer(for: board.id) }) {
                HStack(spacing: 10) {
                    Text("New Task")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(TaskifyTheme.textSecondary)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .frame(height: 48)
            }
            .buttonStyle(.plain)
            .pwaSurface(cornerRadius: 24, fill: TaskifyTheme.pwaTask, stroke: TaskifyTheme.pwaTaskStroke)

            Button(action: { viewModel.openComposer(for: board.id) }) {
                Image(systemName: "plus")
                    .font(.system(size: 21, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 48, height: 48)
                    .background(TaskifyTheme.accent)
                    .clipShape(Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private var weekDates: [Date] {
        let today = Date()
        let weekday = calendar.component(.weekday, from: today)
        let start = calendar.date(byAdding: .day, value: -(weekday - 1), to: calendar.startOfDay(for: today)) ?? today
        return (0..<7).compactMap { calendar.date(byAdding: .day, value: $0, to: start) }
    }

    private func tasksForDay(_ day: Date) -> [TaskifyTask] {
        let undated = tasks.filter { ($0.dueISO ?? "").isEmpty }
        let dated = tasks.filter { task in
            guard let due = task.dueISO, !due.isEmpty,
                  let date = ISO8601DateFormatter().date(from: due) else {
                return false
            }
            return calendar.isDate(date, inSameDayAs: day)
        }

        if calendar.isDateInToday(day) {
            return dated + undated
        }
        return dated
    }
}
