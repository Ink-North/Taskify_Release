import Foundation
import SwiftData

// MARK: - Task Types

public enum TaskPriority: Int, Codable {
    case low = 1
    case medium = 2
    case high = 3
}

public enum RecurrenceType: String, Codable {
    case none
    case daily
    case weekly
    case every
    case monthlyDay
}

public struct RecurrenceRule: Codable {
    public let type: RecurrenceType
    public let unit: String? // "day" or "week" or "hour"
    public let n: Int?
    public let days: [Int]? // Days of week for weekly (0-6, where 0 is Sunday)
    public let day: Int? // Day of month (1-28)
    public let interval: Int?
    public let untilISO: String?

    public init(
        type: RecurrenceType,
        unit: String? = nil,
        n: Int? = nil,
        days: [Int]? = nil,
        day: Int? = nil,
        interval: Int? = nil,
        untilISO: String? = nil
    ) {
        self.type = type
        self.unit = unit
        self.n = n
        self.days = days
        self.day = day
        self.interval = interval
        self.untilISO = untilISO
    }
}

public struct Bounty: Codable {
    public let owner: String // hex
    public let sender: String // hex
    public let receiver: String // hex
    public let token: String
    public let enc: String?
    public let state: String // "locked" | "unlocked" | "claimed" | "revoked"
    public let lock: String? // "none" | "p2pk" | "unknown"

    public init(
        owner: String,
        sender: String,
        receiver: String,
        token: String,
        enc: String? = nil,
        state: String = "locked",
        lock: String? = "unknown"
    ) {
        self.owner = owner
        self.sender = sender
        self.receiver = receiver
        self.token = token
        self.enc = enc
        self.state = state
        self.lock = lock
    }
}

public struct Task: Identifiable, Codable {
    public let id: String
    public let boardId: String
    public let title: String
    public let note: String?
    public let dueISO: String
    public let dueDateEnabled: Bool?
    public let dueTimeEnabled: Bool?
    public let dueTimeZone: String?
    public let priority: TaskPriority?
    public let createdAt: Int
    public let order: Int
    public let column: String?
    public let completed: Bool
    public let completedAt: String?
    public let hiddenUntilISO: String?
    public let recurrence: RecurrenceRule?
    public let seriesId: String?
    public let streak: Int?
    public let longestStreak: Int?
    public let bounty: Bounty?
    public let bountyDeletedAt: String?
    public let bountyLists: [String]?
    public let reminders: [String]?
    public let reminderTime: String?
    public let documents: [Document]?
    public let scriptureMemoryId: String?
    public let scriptureMemoryStage: Int?
    public let scriptureMemoryPrevReviewISO: String?
    public let scriptureMemoryScheduledAt: String?

    public init(
        id: String,
        boardId: String,
        title: String,
        note: String? = nil,
        dueISO: String,
        dueDateEnabled: Bool? = true,
        dueTimeEnabled: Bool? = false,
        dueTimeZone: String? = nil,
        priority: TaskPriority? = nil,
        createdAt: Int = Int(Date().timeIntervalSince1970 * 1000),
        order: Int = 0,
        column: String? = "day",
        completed: Bool = false,
        completedAt: String? = nil,
        hiddenUntilISO: String? = nil,
        recurrence: RecurrenceRule? = nil,
        seriesId: String? = nil,
        streak: Int? = nil,
        longestStreak: Int? = nil,
        bounty: Bounty? = nil,
        bountyDeletedAt: String? = nil,
        bountyLists: [String]? = nil,
        reminders: [String]? = nil,
        reminderTime: String? = nil,
        documents: [Document]? = nil,
        scriptureMemoryId: String? = nil,
        scriptureMemoryStage: Int? = nil,
        scriptureMemoryPrevReviewISO: String? = nil,
        scriptureMemoryScheduledAt: String? = nil
    ) {
        self.id = id
        self.boardId = boardId
        self.title = title
        self.note = note
        self.dueISO = dueISO
        self.dueDateEnabled = dueDateEnabled
        self.dueTimeEnabled = dueTimeEnabled
        self.dueTimeZone = dueTimeZone
        self.priority = priority
        self.createdAt = createdAt
        self.order = order
        self.column = column
        self.completed = completed
        self.completedAt = completedAt
        self.hiddenUntilISO = hiddenUntilISO
        self.recurrence = recurrence
        self.seriesId = seriesId
        self.streak = streak
        self.longestStreak = longestStreak
        self.bounty = bounty
        self.bountyDeletedAt = bountyDeletedAt
        self.bountyLists = bountyLists
        self.reminders = reminders
        self.reminderTime = reminderTime
        self.documents = documents
        self.scriptureMemoryId = scriptureMemoryId
        self.scriptureMemoryStage = scriptureMemoryStage
        self.scriptureMemoryPrevReviewISO = scriptureMemoryPrevReviewISO
        self.scriptureMemoryScheduledAt = scriptureMemoryScheduledAt
    }
}

public struct Document: Codable {
    public let id: String
    public let name: String
    public let mimeType: String?
    public let size: Int?
    public let createdAt: Int?

    public init(
        id: String,
        name: String,
        mimeType: String? = nil,
        size: Int? = nil,
        createdAt: Int? = Int(Date().timeIntervalSince1970 * 1000)
    ) {
        self.id = id
        self.name = name
        self.mimeType = mimeType
        self.size = size
        self.createdAt = createdAt
    }
}

// MARK: - Calendar Event Types

public enum EventKind: String, Codable {
    case date
    case time
}

public struct CalendarEventParticipant: Codable {
    public let pubkey: String
    public let relay: String?
    public let role: String?

    public init(pubkey: String, relay: String? = nil, role: String? = nil) {
        self.pubkey = pubkey
        self.relay = relay
        self.role = role
    }
}

public struct CalendarEvent: Identifiable, Codable {
    public let id: String
    public let boardId: String
    public let columnId: String?
    public let order: Int
    public let title: String
    public let summary: String?
    public let description: String?
    public let documents: [Document]?
    public let image: String?
    public let locations: [String]?
    public let geohash: String?
    public let reminders: [String]?
    public let reminderTime: String?
    public let readOnly: Bool?
    public let hiddenUntilISO: String?
    public let recurrence: RecurrenceRule?
    public let seriesId: String?
    public let kind: EventKind
    public let startISO: String?
    public let endISO: String?
    public let startTzid: String?
    public let endTzid: String?
    public let startDate: String?
    public let endDate: String?
    public let participants: [CalendarEventParticipant]?
    public let hashtags: [String]?
    public let references: [String]?
    public let external: Bool?
    public let originBoardId: String?
    public let eventKey: String?
    public let inviteTokens: [String: String]?
    public let canonicalAddress: String?
    public let viewAddress: String?
    public let inviteToken: String?
    public let inviteRelays: [String]?
    public let boardPubkey: String?
    public let rsvpStatus: String?
    public let rsvpCreatedAt: Int?
    public let rsvpFb: String?

    public init(
        id: String,
        boardId: String,
        title: String,
        kind: EventKind = .time,
        startISO: String? = nil,
        endISO: String? = nil,
        startTzid: String? = nil,
        endTzid: String? = nil,
        columnId: String? = nil,
        order: Int = 0,
        summary: String? = nil,
        description: String? = nil,
        documents: [Document]? = nil,
        image: String? = nil,
        locations: [String]? = nil,
        geohash: String? = nil,
        reminders: [String]? = nil,
        reminderTime: String? = nil,
        readOnly: Bool? = nil,
        hiddenUntilISO: String? = nil,
        recurrence: RecurrenceRule? = nil,
        seriesId: String? = nil,
        participants: [CalendarEventParticipant]? = nil,
        hashtags: [String]? = nil,
        references: [String]? = nil,
        external: Bool? = false,
        originBoardId: String? = nil,
        eventKey: String? = nil,
        inviteTokens: [String: String]? = nil,
        canonicalAddress: String? = nil,
        viewAddress: String? = nil,
        inviteToken: String? = nil,
        inviteRelays: [String]? = nil,
        boardPubkey: String? = nil,
        rsvpStatus: String? = nil,
        rsvpCreatedAt: Int? = nil,
        rsvpFb: String? = "free",
        startDate: String? = nil,
        endDate: String? = nil
    ) {
        self.id = id
        self.boardId = boardId
        self.title = title
        self.kind = kind
        self.startISO = startISO
        self.endISO = endISO
        self.startTzid = startTzid
        self.endTzid = endTzid
        self.columnId = columnId
        self.order = order
        self.summary = summary
        self.description = description
        self.documents = documents
        self.image = image
        self.locations = locations
        self.geohash = geohash
        self.reminders = reminders
        self.reminderTime = reminderTime
        self.readOnly = readOnly
        self.hiddenUntilISO = hiddenUntilISO
        self.recurrence = recurrence
        self.seriesId = seriesId
        self.participants = participants
        self.hashtags = hashtags
        self.references = references
        self.external = external
        self.originBoardId = originBoardId
        self.eventKey = eventKey
        self.inviteTokens = inviteTokens
        self.canonicalAddress = canonicalAddress
        self.viewAddress = viewAddress
        self.inviteToken = inviteToken
        self.inviteRelays = inviteRelays
        self.boardPubkey = boardPubkey
        self.rsvpStatus = rsvpStatus
        self.rsvpCreatedAt = rsvpCreatedAt
        self.rsvpFb = rsvpFb
        self.startDate = startDate
        self.endDate = endDate
    }
}

// MARK: - Board Types

public enum BoardKind: String, Codable {
    case week
    case lists
    case compound
    case bible
    case list
}

public struct Board: Identifiable, Codable {
    public let id: String
    public let name: String
    public let kind: BoardKind
    public let archived: Bool
    public let hidden: Bool
    public let clearCompletedDisabled: Bool
    public let columns: [ListColumn]?
    public let children: [String]?
    public let nostr: BoardNostrInfo?
    public let indexCardEnabled: Bool
    public let hideChildBoardNames: Bool

    public init(
        id: String,
        name: String,
        kind: BoardKind = .week,
        archived: Bool = false,
        hidden: Bool = false,
        clearCompletedDisabled: Bool = false,
        columns: [ListColumn]? = nil,
        children: [String]? = nil,
        nostr: BoardNostrInfo? = nil,
        indexCardEnabled: Bool = false,
        hideChildBoardNames: Bool = false
    ) {
        self.id = id
        self.name = name
        self.kind = kind
        self.archived = archived
        self.hidden = hidden
        self.clearCompletedDisabled = clearCompletedDisabled
        self.columns = columns
        self.children = children
        self.nostr = nostr
        self.indexCardEnabled = indexCardEnabled
        self.hideChildBoardNames = hideChildBoardNames
    }
}

public struct ListColumn: Identifiable, Codable {
    public let id: String
    public let name: String

    public init(id: String, name: String) {
        self.id = id
        self.name = name
    }
}

public struct BoardNostrInfo: Codable {
    public let boardId: String?
    public let relays: [String]?
    public let description: String?

    public init(boardId: String? = nil, relays: [String]? = nil, description: String? = nil) {
        self.boardId = boardId
        self.relays = relays
        self.description = description
    }
}

// MARK: - Settings

public struct Settings: Codable {
    public let timeZone: String?
    public let weekStart: Int
    public let newTaskPosition: String // "bottom" | "top"
    public let defaultBoardId: String
    public let notificationsEnabled: Bool
    public let soundEnabled: Bool
    public let darkMode: Bool?

    public init(
        timeZone: String? = nil,
        weekStart: Int = 1, // Monday
        newTaskPosition: String = "bottom",
        defaultBoardId: String = "week-default",
        notificationsEnabled: Bool = true,
        soundEnabled: Bool = true,
        darkMode: Bool? = nil
    ) {
        self.timeZone = timeZone
        self.weekStart = weekStart
        self.newTaskPosition = newTaskPosition
        self.defaultBoardId = defaultBoardId
        self.notificationsEnabled = notificationsEnabled
        self.soundEnabled = soundEnabled
        self.darkMode = darkMode
    }
}