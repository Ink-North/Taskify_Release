import Foundation
import Testing
@testable import TaskifyCore

@MainActor
@Suite("ContactsViewModel")
struct ContactsViewModelTests {

    @Test("sets empty and ready states from contact payloads")
    func states() {
        let vm = ContactsViewModel()
        vm.setContacts([])
        #expect(vm.state == .empty)

        vm.setContacts([
            TaskifyContactRecord(
                id: "1",
                kind: .custom,
                name: "Alice",
                address: "",
                paymentRequest: "",
                npub: "",
                createdAt: 1,
                updatedAt: 1
            )
        ])
        #expect(vm.state == .ready)
    }

    @Test("filters contacts by multiple fields")
    func filtersContacts() {
        let vm = ContactsViewModel()
        vm.setContacts([
            TaskifyContactRecord(
                id: "1",
                kind: .nostr,
                name: "Alice",
                address: "alice@getalby.com",
                paymentRequest: "",
                npub: "npub1alice",
                username: "alice",
                displayName: "Alice Example",
                createdAt: 1,
                updatedAt: 1
            ),
            TaskifyContactRecord(
                id: "2",
                kind: .custom,
                name: "Bob",
                address: "",
                paymentRequest: "",
                npub: "",
                createdAt: 1,
                updatedAt: 1
            ),
        ])

        #expect(vm.filteredContacts(searchText: "getalby").map(\.id) == ["1"])
        #expect(vm.filteredContacts(searchText: "bob").map(\.id) == ["2"])
    }
}
