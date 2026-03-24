import SwiftUI
import SwiftData
import TaskifyCore

struct TaskComposerView: View {
    @Environment(\.dismiss) private var dismiss
    @Query(sort: \TaskifyBoard.name) private var boards: [TaskifyBoard]
    @Binding var draft: TaskDraft
    let isEditing: Bool
    let onSave: () -> Void
    let onDelete: (() -> Void)?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text(isEditing ? "Edit Task" : "New Task")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text("Quick capture styled like the PWA, but native.")
                        .font(.subheadline)
                        .foregroundStyle(TaskifyTheme.textSecondary)

                    GlassSectionCard(title: "Details") {
                        VStack(spacing: 12) {
                            textField("Title", text: $draft.title)
                            textField("Notes", text: $draft.note, axis: .vertical)
                        }
                    }

                    GlassSectionCard(title: "Placement") {
                        VStack(spacing: 12) {
                            Picker("Board", selection: Binding(get: {
                                draft.boardId ?? boards.first?.id ?? ""
                            }, set: {
                                draft.boardId = $0
                                if availableColumns.isEmpty {
                                    draft.columnId = nil
                                } else if !availableColumns.contains(where: { $0.id == draft.columnId }) {
                                    draft.columnId = availableColumns.first?.id
                                }
                            })) {
                                ForEach(boards, id: \.id) { board in
                                    Text(board.name).tag(board.id)
                                }
                            }
                            .pickerStyle(.menu)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                            .background(Color.white.opacity(0.05))
                            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))

                            if !availableColumns.isEmpty {
                                Picker("Column", selection: Binding(get: {
                                    draft.columnId ?? availableColumns.first?.id ?? ""
                                }, set: { draft.columnId = $0 })) {
                                    ForEach(availableColumns, id: \.id) { column in
                                        Text(column.name).tag(column.id)
                                    }
                                }
                                .pickerStyle(.menu)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(14)
                                .background(Color.white.opacity(0.05))
                                .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                            }

                            Toggle(isOn: Binding(get: {
                                draft.dueDate != nil
                            }, set: { enabled in
                                draft.dueDate = enabled ? (draft.dueDate ?? Date()) : nil
                            })) {
                                Text("Due date")
                                    .foregroundStyle(TaskifyTheme.textPrimary)
                            }
                            .tint(TaskifyTheme.accent)

                            if draft.dueDate != nil {
                                DatePicker("", selection: Binding(get: {
                                    draft.dueDate ?? Date()
                                }, set: { draft.dueDate = $0 }), displayedComponents: [.date])
                                .datePickerStyle(.graphical)
                                .colorScheme(.dark)
                            }

                            Picker("Priority", selection: $draft.priority) {
                                Text("None").tag(0)
                                Text("High").tag(1)
                                Text("Medium").tag(2)
                                Text("Low").tag(3)
                            }
                            .pickerStyle(.segmented)
                        }
                    }

                    if let onDelete, isEditing {
                        Button(role: .destructive, action: {
                            onDelete()
                            dismiss()
                        }) {
                            Text("Delete Task")
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                        }
                        .buttonStyle(.bordered)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 40)
            }
            .taskifyScreen()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        onSave()
                    }
                    .fontWeight(.semibold)
                }
            }
        }
        .onAppear {
            if draft.boardId == nil {
                draft.boardId = boards.first?.id
            }
            if draft.columnId == nil, let first = availableColumns.first?.id {
                draft.columnId = first
            }
        }
    }

    private var availableColumns: [BoardColumn] {
        guard let boardId = draft.boardId,
              let board = boards.first(where: { $0.id == boardId }),
              board.kind == "lists",
              let json = board.columnsJSON?.data(using: .utf8),
              let cols = try? JSONDecoder().decode([BoardColumn].self, from: json) else {
            return []
        }
        return cols
    }

    private func textField(_ title: String, text: Binding<String>, axis: Axis = .horizontal) -> some View {
        TextField(title, text: text, axis: axis)
            .textFieldStyle(.plain)
            .foregroundStyle(TaskifyTheme.textPrimary)
            .padding(14)
            .background(Color.white.opacity(0.05))
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}
